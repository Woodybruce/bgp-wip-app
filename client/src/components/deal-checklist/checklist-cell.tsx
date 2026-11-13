// The deal checklist in the Letting Tracker's main table (Woody, 2026-11-13:
// "swap the check list and against the brief"). One cell per unit: how many
// items are done, a bar, what is still required at the deal's stage and who
// is responsible for the deal. Clicking it opens the checklist.
import { ListChecks } from "lucide-react";
import type { ChecklistChipSummary } from "./checklist-chip";

export function checklistCellLines(summary: ChecklistChipSummary): { headline: string; percent: number; status: string; statusTone: "done" | "required" | "quiet"; overdue: string | null; responsible: string } {
  const allDone = summary.total > 0 && summary.done === summary.total;
  const percent = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
  return {
    headline: allDone ? "Checklist done" : `${summary.done} of ${summary.total} done`,
    percent,
    status: allDone ? "Every item is ticked"
      : summary.requiredOpen > 0 ? `${summary.requiredOpen} required at this stage still open`
      : "Nothing required is outstanding",
    statusTone: allDone ? "done" : summary.requiredOpen > 0 ? "required" : "quiet",
    overdue: !allDone && summary.overdue > 0 ? `${summary.overdue} overdue` : null,
    responsible: summary.responsibleName ? `Responsible: ${summary.responsibleName}` : "Nobody responsible yet",
  };
}

export function TrackerChecklistCell({ unitId, summary, onOpen, compact = false }: {
  unitId: string;
  summary: ChecklistChipSummary | null | undefined;
  onOpen: () => void;
  compact?: boolean;            // the phone card: no hover block, full width
}) {
  if (!summary) {
    return (
      <button type="button" className={`inline-flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40 ${compact ? "mt-1.5 min-h-8" : ""}`} onClick={onOpen} data-testid={`${compact ? "mobile-checklist" : "cell-checklist"}-${unitId}`} title="Start the deal checklist for this unit">
        <ListChecks className="h-3 w-3" /> Start the checklist
      </button>
    );
  }
  const l = checklistCellLines(summary);
  const amber = "font-medium text-amber-700 dark:text-amber-400";
  return (
    <button
      type="button"
      className={compact ? "mt-1.5 block w-full text-left" : "block w-full rounded-md p-1 -m-1 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"}
      onClick={onOpen}
      data-testid={`${compact ? "mobile-checklist" : "cell-checklist"}-${unitId}`}
      aria-label={`Deal checklist: ${l.headline}. ${l.status}. ${l.responsible}. Open the checklist.`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold tabular-nums">{l.headline}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{l.percent}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-muted-foreground/20" aria-hidden>
        <div className={`h-full rounded-sm ${l.statusTone === "done" ? "bg-emerald-600" : "bg-primary"}`} style={{ width: `${l.percent}%` }} />
      </div>
      <p className={`mt-1 text-[11px] leading-tight ${l.statusTone === "required" ? amber : "text-muted-foreground"}`}>{l.status}{l.overdue && <span className={amber}> · {l.overdue}</span>}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{l.responsible}</p>
    </button>
  );
}
