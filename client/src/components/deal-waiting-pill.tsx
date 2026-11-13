// "Deal is waiting on you" on a task (Woody, 2026-11-13: the waiting-on
// "needs to be linked to the deal check tasks list ... each person to have
// this update their own task list"). GET /api/tasks marks a task made for a
// deal checklist item when the deal's waiting-on is that item (waitingOnDeal)
// and says for how many days (waitingDays). Every task list shows this one
// pill on those rows and puts them first: My Tasks, the Landsec Tasks page
// and the phone home.
import { Link } from "wouter";
import { Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import { pillMetrics } from "@/components/ui/pill";

export interface WaitingTaskFields { status?: string | null; waitingOnDeal?: boolean | null; waitingDays?: number | null }

// Is the deal waiting on this task now? A finished task never is.
export const dealIsWaitingOn = (t: WaitingTaskFields | null | undefined): boolean => !!t && !!t.waitingOnDeal && t.status !== "done";

// "today", "1 day", "12 days"; nothing when the server sent no count.
export function waitingDaysText(days: number | null | undefined): string {
  if (typeof days !== "number" || !Number.isFinite(days) || days < 0) return "";
  const whole = Math.floor(days);
  return whole === 0 ? "today" : whole === 1 ? "1 day" : `${whole} days`;
}

// The tasks a deal is waiting on first, the longest wait at the top; every
// other task keeps the order it came in.
export function waitedOnFirst<T extends WaitingTaskFields>(rows: T[]): T[] {
  const waiting = rows.filter(dealIsWaitingOn).sort((a, b) => (b.waitingDays ?? -1) - (a.waitingDays ?? -1));
  return waiting.length ? [...waiting, ...rows.filter(t => !dealIsWaitingOn(t))] : rows;
}

// The pill. `who` names the person when the list is of tasks set for other
// people ("Deal is waiting on Sam Cole"). With `href` it opens where the
// work is (the unit's deal checklist).
export function DealWaitingPill({ days, who, href, className, testId }: {
  days?: number | null; who?: string | null; href?: string | null; className?: string; testId?: string;
}) {
  const since = waitingDaysText(days);
  const label = `Deal is waiting on ${who || "you"}`;
  const title = `${label}${since ? (since === "today" ? ", since today" : `, for ${since}`) : ""}. It is the item on the deal checklist that the deal's waiting-on points at${href ? ": open the checklist" : ""}.`;
  const body = (
    <span
      className={cn(pillMetrics, "max-w-full border border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400", href && "cursor-pointer hover:bg-amber-500/20", className)}
      title={title}
      data-testid={testId || "task-deal-waiting"}
    >
      <Hourglass className="h-3 w-3 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{label}{since ? ` · ${since}` : ""}</span>
    </span>
  );
  return href ? <Link href={href} className="inline-flex max-w-full">{body}</Link> : body;
}
