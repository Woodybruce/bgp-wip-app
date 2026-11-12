// The success monitor on the Letting Tracker's main table (Woody,
// 2026-11-12: "show how close we are to hitting the brief"). One cell per
// unit: a stepped bar, how many steps are done, what comes next and the
// brief's next deadline. Clicking it lists every step with where it stands.
import { Check, Circle, CircleDashed, Target } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { briefProgress, type BriefProgress, type BriefProgressInput } from "@shared/brief-progress";

const fmtDay = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function deadlineText(d: NonNullable<BriefProgress["deadline"]>): string {
  if (d.overdue) return `${d.label} passed ${d.days === 1 ? "1 day" : `${d.days} days`} ago`;
  if (d.days === 0) return `${d.label} is today`;
  return `${d.label} ${fmtDay(d.date)} · ${d.days === 1 ? "1 day" : `${d.days} days`}`;
}

function Bar({ p, className = "" }: { p: BriefProgress; className?: string }) {
  return (
    <div className={`flex gap-px ${className}`} aria-hidden>
      {p.steps.map(s => (
        <span key={s.key} className={`h-1.5 flex-1 rounded-sm ${s.done ? (p.state === "complete" && p.outcome !== "below" ? "bg-emerald-600" : "bg-primary") : "bg-muted-foreground/20"}`} />
      ))}
    </div>
  );
}

export function TrackerSuccessCell({ unitId, input, onOpenBrief, compact = false }: {
  unitId: string;
  input: BriefProgressInput;
  onOpenBrief: () => void;      // the unit's Targeting Brief (or Add brief when it has none)
  compact?: boolean;            // the phone card: bar and one line, no popover
}) {
  const p = briefProgress(input);
  if (p.state === "no_brief") {
    if (compact) return null;
    return (
      <button type="button" className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40" onClick={onOpenBrief} data-testid={`cell-success-add-brief-${unitId}`}>
        <Target className="h-3 w-3" /> Start the brief
      </button>
    );
  }
  if (p.state === "withdrawn") return compact ? null : <span className="text-[11px] text-muted-foreground" data-testid={`cell-success-${unitId}`}>Withdrawn</span>;

  const summary = p.state !== "complete" ? `${p.done} of ${p.total} steps`
    : p.outcome === "hit" ? "Let: brief hit" : p.outcome === "below" ? "Let below the brief" : "Let";
  const line = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold tabular-nums">{summary}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{p.percent}%</span>
      </div>
      <Bar p={p} className="mt-1" />
      {p.next && <p className="mt-1 text-[11px] leading-tight text-muted-foreground"><span className="text-foreground">Next:</span> {p.next}</p>}
      {p.deadline && (
        <p className={`mt-0.5 text-[11px] leading-tight tabular-nums ${p.deadline.overdue ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>{deadlineText(p.deadline)}</p>
      )}
    </>
  );
  if (compact) {
    return <button type="button" className="mt-1.5 block w-full text-left" onClick={onOpenBrief} data-testid={`mobile-success-${unitId}`} aria-label={`Progress against the brief: ${summary}. Open the brief.`}>{line}</button>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="block w-full rounded-md p-1 -m-1 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`cell-success-${unitId}`} aria-label={`Progress against the brief: ${summary}. Show the steps.`}>
          {line}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3" data-testid={`success-steps-${unitId}`}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">Against the brief</p>
          <p className="text-xs tabular-nums text-muted-foreground">{summary} · {p.percent}%</p>
        </div>
        <Bar p={p} className="mt-2" />
        <ul className="mt-3 space-y-1.5">
          {p.steps.map(s => (
            <li key={s.key} className="flex items-start gap-2 text-xs leading-tight" data-testid={`success-step-${s.key}`}>
              {s.done
                ? (s.implied ? <CircleDashed className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Counted as done, nothing recorded" /> : <Check className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Done" />)
                : <Circle className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-label="Not yet" />}
              <span className="min-w-0">
                <span className={s.done ? "font-medium" : "font-medium text-muted-foreground"}>{s.label}</span>
                <span className="block text-muted-foreground">{s.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        {p.deadline && <p className={`mt-3 text-xs tabular-nums ${p.deadline.overdue ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>{deadlineText(p.deadline)}</p>}
        <Button variant="outline" size="sm" className="mt-3 h-7 w-full text-xs" onClick={onOpenBrief} data-testid={`success-open-brief-${unitId}`}>Open the brief</Button>
      </PopoverContent>
    </Popover>
  );
}
