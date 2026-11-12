// Where a letting's deal checklist stands, as one small chip that opens it:
// not started, how many items are done, required items still open at the
// deal's stage, or everything done. Sits beside the brief chip on the
// Letting Tracker row and matches it (unit-brief/brief-chip.tsx).
import { ListChecks } from "lucide-react";
import type { ChecklistSummary } from "@shared/deal-checklist";

export type ChecklistChipSummary = ChecklistSummary & { responsibleName: string | null };

export function checklistChipLabel(summary: ChecklistChipSummary | null | undefined): { label: string; tone: "done" | "required" | "quiet" } {
  if (!summary) return { label: "Checklist", tone: "quiet" };
  if (summary.total > 0 && summary.done === summary.total) return { label: "Checklist done", tone: "done" };
  const progress = `Checklist ${summary.done}/${summary.total}`;
  if (summary.requiredOpen > 0) return { label: `${progress} · ${summary.requiredOpen} required`, tone: "required" };
  return { label: progress, tone: "quiet" };
}

export function ChecklistChip({ summary, onClick, testId }: { summary: ChecklistChipSummary | null | undefined; onClick: () => void; testId?: string }) {
  const { label, tone } = checklistChipLabel(summary);
  const cls = tone === "done" ? "border-emerald-600/60 text-emerald-700 dark:text-emerald-400"
    : tone === "required" ? "border-amber-500/60 text-amber-700 dark:text-amber-400"
    : "border-border text-muted-foreground hover:text-foreground";
  const title = !summary ? "Start the deal checklist for this unit"
    : summary.responsibleName ? `Responsible for the deal: ${summary.responsibleName}`
    : "Nobody is responsible for this deal yet";
  return (
    <button
      type="button"
      data-no-min-touch
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap leading-none ${cls}`}
      data-testid={testId}
    >
      <ListChecks className="h-2.5 w-2.5" /> {label}
    </button>
  );
}
