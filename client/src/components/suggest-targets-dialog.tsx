// AI brand suggestions for a letting unit — the fits engine in reverse:
// live requirements whose size/use/location fit the unit plus tracked brands
// in matching categories, ranked by Fable with a concrete reason each.
// Shared surface (letting tracker, property page) so every board offers the
// same "who should we pitch this to" answer. One click targets the brand on
// the unit's Operator Targeting Brief; callers can pass their own onAdd to
// attach agents/categories, otherwise the built-in default is used.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { type BrandPick } from "@/components/brand-search-input";

// ─── AI target suggestions ──────────────────────────────────────────────
// The fits engine in reverse: live requirements whose size/use/location
// fit this unit plus tracked brands in matching categories, ranked by
// Fable with a concrete reason each. One click adds the brand to the
// unit's Operator Targeting Brief.
export function SuggestTargetsDialog({ unit, onClose, onAdd }: {
  unit: { id: string; unitName: string } | null;
  onClose: () => void;
  onAdd?: (pick: BrandPick) => Promise<void>;
}) {
  const { toast } = useToast();
  const defaultAdd = async (pick: BrandPick) => {
    const res = await apiRequest("POST", "/api/unit-briefs", { unitId: unit!.id });
    const brief = await res.json();
    await apiRequest("POST", `/api/unit-briefs/${brief.id}/targets`, {
      operatorName: pick.name,
      companyId: pick.companyId,
      priority: "B",
    });
    queryClient.invalidateQueries({ queryKey: ["/api/unit-briefs"] });
    toast({ title: "Target added", description: pick.name });
  };
  const add = onAdd || defaultAdd;
  const [addingIdx, setAddingIdx] = useState<number | null>(null);
  const [addedIdx, setAddedIdx] = useState<Set<number>>(new Set());
  const { data, isFetching } = useQuery<any>({
    queryKey: ["/api/available-units", unit?.id, "brand-suggestions"],
    queryFn: async () => {
      const res = await fetch(`/api/available-units/${unit!.id}/brand-suggestions`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("suggestion scan failed");
      return res.json();
    },
    enabled: !!unit,
    staleTime: 5 * 60 * 1000,
  });
  const suggestions: any[] = data?.suggestions || [];
  return (
    <Dialog open={!!unit} onOpenChange={(o) => { if (!o) { setAddedIdx(new Set()); onClose(); } }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-muted-foreground" />
            Suggested brands — {unit?.unitName}{data?.unit?.sqft ? ` (${Number(data.unit.sqft).toLocaleString()} sq ft)` : ""}
          </DialogTitle>
          <DialogDescription>
            Live requirements that fit this unit, plus tracked brands in matching categories — ranked by AI.
          </DialogDescription>
        </DialogHeader>
        {isFetching ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Matching live requirements + brand book, AI ranking… ~15s</p>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No confident suggestions — try adding a size to the unit, or search manually.</p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto space-y-1.5 pr-1" data-testid="suggested-brands-list">
            {suggestions.map((s: any, i: number) => (
              <div key={`${s.companyId || s.name}-${i}`} className="flex items-center gap-2 border rounded-md px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {s.name}
                    <Badge variant="outline" className={`ml-2 text-[9px] ${s.source === "live_requirement" ? "text-emerald-700 border-emerald-200" : "text-blue-700 border-blue-200"}`}>
                      {s.source === "live_requirement" ? "live requirement" : "tracked brand"}
                    </Badge>
                    {s.aiScore != null && <span className="ml-2 text-[10px] text-muted-foreground tabular-nums">{s.aiScore}</span>}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate" title={s.reason || ""}>
                    {s.reason || [s.size, s.use, s.agent && `via ${s.agent}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {addedIdx.has(i) ? (
                  <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-200 shrink-0">targeted</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-[11px] shrink-0"
                    disabled={addingIdx === i}
                    onClick={async () => {
                      setAddingIdx(i);
                      try {
                        await add({ name: s.name, companyId: s.companyId || undefined, companyType: s.category || undefined } as BrandPick);
                        setAddedIdx((prev) => new Set(prev).add(i));
                      } finally { setAddingIdx(null); }
                    }}
                    data-testid={`button-target-suggested-${i}`}
                  >
                    {addingIdx === i ? <Loader2 className="w-3 h-3 animate-spin" /> : "+ Target"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
