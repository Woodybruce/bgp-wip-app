// THROWAWAY: mounts the transaction recommendation dialog and chip for testing. Delete before finishing.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RecommendationDialog } from "@/components/unit-recommendation/recommendation-workspace";
import { RecommendationChip } from "@/components/unit-recommendation/recommendation-chip";
import type { RecommendationSummary } from "@shared/unit-recommendation";

export default function DevRecommendation() {
  const params = new URLSearchParams(window.location.search);
  const unitId = params.get("unit") || "";
  const [open, setOpen] = useState(params.get("open") === "1");
  const [log, setLog] = useState<string[]>([]);
  const summary = useQuery<Record<string, RecommendationSummary>>({ queryKey: ["/api/unit-recommendations/summary"] });
  const mine = summary.data?.[unitId];
  const samples: RecommendationSummary[] = [
    { stage: "draft", approved: 0, total: 2, issuedAt: null }, { stage: "issued", approved: 1, total: 2, issuedAt: "2026-11-12" },
    { stage: "approved", approved: 2, total: 2, issuedAt: "2026-11-12" }, { stage: "declined", approved: 1, total: 2, issuedAt: "2026-11-12" },
  ];
  return (
    <div className="space-y-4 p-6" data-testid="dev-recommendation">
      <p className="text-sm">Dev mount: unit {unitId || "(none)"}</p>
      <div className="flex flex-wrap items-center gap-2" data-testid="dev-chip-live">
        <RecommendationChip summary={mine} onClick={() => setOpen(true)} testId="dev-chip" />
        <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setOpen(true)} data-testid="dev-open">Open the dialog</button>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="dev-chip-samples">
        {samples.map(s => <RecommendationChip key={s.stage} summary={s} onClick={() => setLog(l => [...l, `chip:${s.stage}`])} testId={`dev-chip-${s.stage}`} />)}
        <span data-testid="dev-chip-none"><RecommendationChip summary={null} onClick={() => undefined} testId="dev-chip-null" /></span>
      </div>
      <pre className="text-xs" data-testid="dev-log">{log.join("\n")}</pre>
      <RecommendationDialog
        unit={unitId ? { id: unitId, unitName: "Dev unit", propertyId: null } : null}
        open={open}
        onClose={() => setOpen(false)}
        onOpenHots={() => setLog(l => [...l, "onOpenHots"])}
        onOpenOffers={() => setLog(l => [...l, "onOpenOffers"])}
        onChanged={() => setLog(l => [...l, "onChanged"])}
      />
    </div>
  );
}
