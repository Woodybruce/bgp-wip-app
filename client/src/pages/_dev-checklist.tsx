// THROWAWAY test mount for the deal checklist. Deleted before hand-over.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DealChecklistDialog } from "@/components/deal-checklist/deal-checklist-dialog";
import { ChecklistChip, type ChecklistChipSummary } from "@/components/deal-checklist/checklist-chip";

export default function DevChecklist() {
  const q = new URLSearchParams(window.location.search);
  const unitId = q.get("unit") || "";
  const [open, setOpen] = useState(q.get("open") !== "0");
  const [log, setLog] = useState<string[]>([]);
  const { data } = useQuery<Record<string, ChecklistChipSummary>>({ queryKey: ["/api/deal-checklists/summary"] });
  const samples: (ChecklistChipSummary | null)[] = [
    null,
    { total: 17, done: 5, requiredOpen: 0, unassigned: 0, overdue: 0, responsibleName: "Sophie Hunt" },
    { total: 17, done: 5, requiredOpen: 2, unassigned: 3, overdue: 1, responsibleName: null },
    { total: 17, done: 17, requiredOpen: 0, unassigned: 0, overdue: 0, responsibleName: "Ian Moore" },
  ];
  return (
    <div className="p-4 sm:p-6 space-y-4 min-w-0">
      <div className="flex flex-wrap items-center gap-2" data-testid="dev-chips">
        <ChecklistChip summary={data?.[unitId]} onClick={() => setOpen(true)} testId="dev-chip-live" />
        {samples.map((s, i) => <ChecklistChip key={i} summary={s} onClick={() => setLog(l => [...l, `chip ${i}`])} testId={`dev-chip-${i}`} />)}
      </div>
      <DealChecklistDialog
        unit={unitId ? { id: unitId, unitName: q.get("name") || "Unit", propertyId: null } : null}
        open={open}
        onClose={() => { setOpen(false); setLog(l => [...l, "closed"]); }}
        onChanged={() => setLog(l => [...l, "changed"])}
      />
      <pre className="text-[11px] text-muted-foreground" data-testid="dev-log">{log.join("\n")}</pre>
    </div>
  );
}
