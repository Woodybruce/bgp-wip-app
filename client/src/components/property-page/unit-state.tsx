// How a unit's state is shown everywhere on the plan-led property page: one
// coloured dot and the Letting Tracker's own word. The state and its colour
// come from shared/property-units.ts (the live letting stage, else the
// occupancy), so the list, the plan and the pills cannot disagree.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { rowPill } from "@/components/landsec/deal-clock";
import { UNIT_STATE_HEX, UNIT_STATE_ORDER, UNIT_STUCK_DAYS, unitStateKey, unitStateLabel, type PropertyUnit, type UnitStateKey } from "@shared/property-units";

// An outline with no schedule row (context) and a scan's proposal are not
// units, so they have their own two colours on the plan.
export const CONTEXT_HEX = "#94a3b8";
export const PROPOSAL_HEX = "#d97706";

export function UnitStateDot({ state, className }: { state: UnitStateKey; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)} style={{ backgroundColor: UNIT_STATE_HEX[state] }} />;
}

// "Solicitors · 34d" for a live letting, "Occupied" / "Vacant" / "Not recorded"
// otherwise. The days turn amber once a deal has sat in negotiation too long.
export function UnitStatePill({ unit, className }: { unit: Pick<PropertyUnit, "stage" | "occupancy" | "deal" | "flags">; className?: string }) {
  const state = unitStateKey(unit);
  const days = unit.stage && unit.deal?.days != null ? unit.deal.days : null;
  return (
    <span
      className={cn(rowPill, "gap-1.5 border-border text-foreground", className)}
      title={unit.flags.stuck ? `${days} days at this stage: stuck (${UNIT_STUCK_DAYS} days or more)` : days != null ? `${days} days at this stage` : undefined}
      data-testid="unit-state-pill"
    >
      <UnitStateDot state={state} />
      {unitStateLabel(state)}
      {days != null && <span className={cn("font-mono tabular-nums normal-case", unit.flags.stuck ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{days}d</span>}
    </span>
  );
}

export function UnitBriefTag({ brief }: { brief: PropertyUnit["brief"] }) {
  const tone = brief === "agreed" ? "border-emerald-600/60 text-emerald-700 dark:text-emerald-400" : brief === "drafted" ? "border-amber-500/60 text-amber-700 dark:text-amber-400" : "border-border text-muted-foreground";
  return <span className={cn(rowPill, "px-1.5", tone)}>{brief === "agreed" ? "Brief agreed" : brief === "drafted" ? "Brief unsigned" : "No brief"}</span>;
}

// The key under a plan: only the states that are on it, each with its count.
export function UnitStateLegend({ counts, children, className }: { counts: Partial<Record<UnitStateKey, number>>; children?: ReactNode; className?: string }) {
  const shown = UNIT_STATE_ORDER.filter(state => (counts[state] || 0) > 0);
  if (!shown.length && !children) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)} data-testid="unit-state-legend">
      {shown.map(state => (
        <span key={state} className="inline-flex items-center gap-1.5">
          <UnitStateDot state={state} />{unitStateLabel(state)} <span className="font-mono tabular-nums">{counts[state]}</span>
        </span>
      ))}
      {children}
    </div>
  );
}
