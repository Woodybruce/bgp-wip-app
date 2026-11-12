// Where a unit's Targeting Brief stands, as one small chip that opens it:
// agreed, awaiting sign-off (how many of the people involved have agreed),
// written but with no one added yet, or no brief. Used on the Letting
// Tracker row, the phone card and the Landsec unit page.
import { Target } from "lucide-react";

export interface BriefChipInfo { id?: string; signoff?: { total: number; agreed: number } | null; agreedAt?: string | null }

export function briefChipLabel(brief: BriefChipInfo | null | undefined): { label: string; tone: "agreed" | "waiting" | "quiet" } {
  if (!brief?.id) return { label: "Add brief", tone: "quiet" };
  const s = brief.signoff;
  if (s && s.total > 0 && s.agreed === s.total) return { label: "Brief agreed", tone: "agreed" };
  if (s && s.total > 0) return { label: `Sign-off ${s.agreed}/${s.total}`, tone: "waiting" };
  return { label: "Brief", tone: "quiet" };
}

export function BriefChip({ brief, onClick, testId }: { brief: BriefChipInfo | null | undefined; onClick: () => void; testId?: string }) {
  const { label, tone } = briefChipLabel(brief);
  const cls = tone === "agreed" ? "border-emerald-600/60 text-emerald-700 dark:text-emerald-400"
    : tone === "waiting" ? "border-amber-500/60 text-amber-700 dark:text-amber-400"
    : "border-border text-muted-foreground hover:text-foreground";
  return (
    <button
      type="button"
      data-no-min-touch
      onClick={onClick}
      title={brief?.id ? "Open the targeting brief" : "Start the targeting brief for this unit"}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap leading-none ${cls}`}
      data-testid={testId}
    >
      <Target className="h-2.5 w-2.5" /> {label}
    </button>
  );
}
