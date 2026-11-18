// The deal's stages, the spine of the deal page (Woody, 2026-11-18: "need
// full time line of deal tracking from marketing to completion"): each step
// with the day it was reached, the days spent there and who moved it. The
// rule is buildStageStrip in shared/deal-page.ts; nothing is worked out here.
import { cn } from "@/lib/utils";
import type { StageStrip as Strip, StripStep } from "@shared/deal-page";

const shortDay = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "2-digit" }), timeZone: "Europe/London" }).replace(/\bSept\b/, "Sep");
};
const longDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : "");

function stepTitle(s: StripStep): string {
  if (s.state === "ahead") return s.target ? `${s.label}: target ${longDay(s.target)}` : `${s.label}: not reached`;
  if (!s.reachedAt) return `${s.label}: passed, no date recorded`;
  const parts = [`${s.label}: reached ${longDay(s.reachedAt)}`];
  if (s.byName) parts.push(`moved by ${s.byName}`);
  if (s.days != null) parts.push(`${s.days} day${s.days === 1 ? "" : "s"} ${s.state === "current" ? "so far" : "there"}`);
  if (!s.confirmed) parts.push("the date is not confirmed (a bulk update, or when the deal was added)");
  return parts.join(", ");
}

export function StageStrip({ strip }: { strip: Strip }) {
  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm p-2 min-w-0" data-testid="deal-stage-strip">
      {strip.before && (
        <p className="px-1 pb-1.5 text-xs text-muted-foreground" data-testid="deal-stage-before">
          At <span className="font-medium text-foreground">{strip.before.label}</span>: not on these stages yet.
        </p>
      )}
      <ol className="flex gap-1 overflow-x-auto pb-0.5 [&>li]:shrink-0">
        {strip.steps.map(s => {
          const dated = !!s.reachedAt;
          return (
            <li
              key={s.code}
              className={cn(
                "min-w-[6.25rem] flex-1 rounded-lg px-2 py-1.5",
                s.state === "current" ? "bg-foreground text-background"
                  : s.state === "done" ? "bg-muted text-foreground"
                  : "border border-dashed border-border text-muted-foreground",
              )}
              title={stepTitle(s)}
              data-testid={`deal-stage-${s.code}`}
              data-state={s.state}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide truncate">{s.label}</p>
              <p className={cn("text-[11px] font-mono tabular-nums truncate", s.state !== "current" && "text-muted-foreground", dated && !s.confirmed && "opacity-60")}>
                {s.state === "ahead"
                  ? (s.target ? `Target ${shortDay(s.target)}` : " ")
                  : dated ? `${shortDay(s.reachedAt)}${s.days != null ? ` · ${s.days}d` : ""}` : "—"}
              </p>
            </li>
          );
        })}
      </ol>
      {strip.outcome && (
        <p className="px-1 pt-1.5 text-xs text-muted-foreground" data-testid="deal-stage-outcome">
          <span className="font-medium text-foreground">{strip.outcome.label}</span>
          {strip.outcome.at ? ` on ${longDay(strip.outcome.at)}` : ""}{strip.outcome.byName ? `, by ${strip.outcome.byName}` : ""}.
        </p>
      )}
    </div>
  );
}
