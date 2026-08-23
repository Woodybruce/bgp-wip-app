// The BGP pill standard (Woody, 2026-08-23: the slim Personal/Company tabs
// on the phone finance tile are the look — "amend all pills to look like
// that", one size up). Anatomy: rounded-full capsule, 11px semibold
// UPPERCASE, collapsed line height, snug padding. Use it for tab switches,
// filter chips and dropdown triggers so small controls read the same on
// every screen. data-no-min-touch opts out of the mobile 44px tap-target
// rule — these are deliberately compact.
//
// Colour: active = filled with the theme foreground (dark ink in light mode,
// scheme-aware); inactive = quiet outline. Surfaces with their own dark
// chrome (the phone finance tile, chat headers) keep local colours but MUST
// match these metrics — import pillMetrics for that.
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const pillMetrics =
  "inline-flex items-center gap-1 rounded-full leading-none text-[11px] font-semibold uppercase tracking-wide px-2.5 py-[5px] transition-colors select-none whitespace-nowrap";
export const pillActive = "bg-foreground text-background border border-transparent";
export const pillInactive = "bg-transparent text-muted-foreground border border-border hover:text-foreground";

// Pill-styled shadcn Tabs (docs/DESIGN.md §4). When a page keeps the Tabs
// component for its content panels, pass these to TabsList / TabsTrigger so
// the row reads as the standard pills instead of the grey segmented box.
export const pillTabsList =
  "h-auto bg-transparent p-0 gap-1.5 flex flex-wrap justify-start";
export const pillTabsTrigger = cn(
  pillMetrics,
  "border border-border bg-transparent text-muted-foreground hover:text-foreground data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:border-transparent data-[state=active]:shadow-none",
);

export const Pill = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>(({ active, className, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    data-no-min-touch
    className={cn(pillMetrics, active ? pillActive : pillInactive, className)}
    {...props}
  >
    {children}
  </button>
));
Pill.displayName = "Pill";

// Small count bubble inside a pill (e.g. an active filter's selection count).
export function PillCount({ n, active }: { n: number; active?: boolean }) {
  return (
    <span
      className={cn(
        "ml-0.5 rounded-full px-1 py-px text-[10px] font-bold leading-none",
        active ? "bg-background/25" : "bg-muted text-foreground/70",
      )}
    >
      {n}
    </span>
  );
}
