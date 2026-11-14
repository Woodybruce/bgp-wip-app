// How a unit's state is shown everywhere on the plan-led property page: one
// coloured dot and the Letting Tracker's own word. The state and its colour
// come from shared/property-units.ts (the live letting stage, else the
// occupancy), so the list, the plan and the pills cannot disagree.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { rowPill } from "@/components/landsec/deal-clock";
import { UNIT_STATE_HEX, UNIT_STATE_ORDER, UNIT_STUCK_DAYS, unitStateKey, unitStateLabel, type PropertyUnit, type UnitStateKey } from "@shared/property-units";
import { stageDaysLabel } from "@shared/stage-since";
import { DEAL_STATUS_LABELS } from "@shared/deal-status";

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
  const unsure = unit.deal?.daysConfirmed === false;
  return (
    <span
      className={cn(rowPill, "gap-1.5 border-border text-foreground", className)}
      title={days == null ? undefined : `${days} days at this stage${unsure ? " (date not confirmed)" : ""}${unit.flags.stuck ? `: stuck (${UNIT_STUCK_DAYS} days or more)` : ""}`}
      data-testid="unit-state-pill"
    >
      <UnitStateDot state={state} />
      {unitStateLabel(state)}
      {days != null && <span className={cn("font-mono tabular-nums normal-case", unit.flags.stuck ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{stageDaysLabel(days, unit.deal?.daysConfirmed)}</span>}
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

// An open deal that is not a letting (a regear, a renewal, a rent review): the
// letting's own stage is already the state pill, so only these get a tag.
export function UnitDealTag({ deal }: { deal: PropertyUnit["deal"] }) {
  if (!deal || deal.letting) return null;
  const status = deal.code ? DEAL_STATUS_LABELS[deal.code] : null;
  const words = [deal.type || "Deal", status].filter(Boolean).join(" · ");
  return <span className={cn(rowPill, "px-1.5 border-border text-muted-foreground")} title={deal.name || words} data-testid="unit-deal-tag">{words}</span>;
}
