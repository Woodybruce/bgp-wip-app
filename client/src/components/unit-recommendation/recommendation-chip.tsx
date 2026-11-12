// Where a letting's transaction recommendation stands, as one small chip
// that opens it: a draft, issued and awaiting the client's decisions (how
// many have approved), approved, or declined. A unit with no recommendation
// shows no chip. Styled as the Targeting Brief chip (brief-chip.tsx).
import { ClipboardCheck } from "lucide-react";
import type { RecommendationSummary } from "@shared/unit-recommendation";

export function recommendationChipLabel(summary: RecommendationSummary): { label: string; tone: "approved" | "waiting" | "declined" | "quiet" } {
  if (summary.stage === "approved") return { label: "Recommendation approved", tone: "approved" };
  if (summary.stage === "declined") return { label: "Recommendation declined", tone: "declined" };
  if (summary.stage === "issued") return { label: `Recommendation ${summary.approved}/${summary.total}`, tone: "waiting" };
  return { label: "Recommendation draft", tone: "quiet" };
}

export function RecommendationChip({ summary, onClick, testId }: { summary: RecommendationSummary | null | undefined; onClick: () => void; testId?: string }) {
  if (!summary || summary.stage === "not_ready") return null;
  const { label, tone } = recommendationChipLabel(summary);
  const cls = tone === "approved" ? "border-emerald-600/60 text-emerald-700 dark:text-emerald-400"
    : tone === "waiting" ? "border-amber-500/60 text-amber-700 dark:text-amber-400"
    : tone === "declined" ? "border-destructive/60 text-destructive"
    : "border-border text-muted-foreground hover:text-foreground";
  return (
    <button
      type="button"
      data-no-min-touch
      onClick={onClick}
      title="Open the transaction recommendation"
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap leading-none ${cls}`}
      data-testid={testId}
    >
      <ClipboardCheck className="h-2.5 w-2.5" /> {label}
    </button>
  );
}
