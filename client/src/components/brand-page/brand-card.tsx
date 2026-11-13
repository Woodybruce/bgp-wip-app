// One card pattern for a brand's page (Woody, 2026-11-12): a small uppercase
// title with a count, one summary line where there is something to say, a
// capped list with "Show all N", and the card's own small action on the right.
// Presentational only.
import { createContext, useContext, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BandHeading } from "./brand-top";

// A card that is also drawn elsewhere (the CRM plan, on the Brand tab of a
// deal) takes this pattern only inside a brand's own page.
const BrandPagePattern = createContext(false);
export const useBrandPagePattern = () => useContext(BrandPagePattern);
export function BrandPatternScope({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <BrandPagePattern.Provider value={on}>{children}</BrandPagePattern.Provider>;
}

export const brandCardClass = "rounded-xl border border-card-border bg-card shadow-sm p-3 min-w-0";
// The small text action a card carries (Refresh, Open calendar, manage).
export const brandCardAction = "text-[11px] text-primary hover:underline disabled:opacity-50 whitespace-nowrap";

export function BrandCard({ title, count, summary, action, testId, className = "", children }: {
  title: React.ReactNode; count?: number | null; summary?: React.ReactNode; action?: React.ReactNode;
  testId?: string; className?: string; children?: React.ReactNode;
}) {
  return (
    <section className={`${brandCardClass} ${className}`} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <BandHeading count={count}>{title}</BandHeading>
        {action}
      </div>
      {summary && <p className="text-[11px] text-muted-foreground mt-0.5">{summary}</p>}
      {children && <div className="mt-2 min-w-0">{children}</div>}
    </section>
  );
}

// A block inside a card that holds several (Live tenancies over Lease events):
// the same title, one size down from a card of its own.
export function BrandBlockHeading({ children, count, action }: { children: React.ReactNode; count?: number | null; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1.5">
      <BandHeading count={count}>{children}</BandHeading>
      {action}
    </div>
  );
}

// The cap: the first `cap` rows, then "Show all N" (and "Show fewer" back).
export function useCap<T>(rows: T[], cap: number) {
  const [open, setOpen] = useState(false);
  const over = rows.length > cap;
  return { shown: over && !open ? rows.slice(0, cap) : rows, over, open, toggle: () => setOpen(v => !v) };
}

export function ShowAll({ total, open, onToggle, testId }: { total: number; open: boolean; onToggle: () => void; testId?: string }) {
  return (
    <button type="button" onClick={onToggle} className="mt-1.5 text-xs text-primary hover:underline" aria-expanded={open} data-testid={testId}>
      {open ? "Show fewer" : <>Show all <span className="font-mono tabular-nums">{total.toLocaleString("en-GB")}</span></>}
    </button>
  );
}

// What staff see in place of an empty card: one quiet line with the action
// that fills it. A client login gets nothing for an empty card. Every quiet
// line on a brand's page is this one style: muted 13px text, the action as a
// text link in the link colour.
export const brandQuietLink = "text-primary hover:underline disabled:opacity-50";
export function BrandQuietLine({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return <p className="text-[13px] leading-snug text-muted-foreground [&_a]:text-[13px] [&_button]:text-[13px] [&_a]:text-primary [&_button]:text-primary [&_a]:no-underline [&_button]:no-underline [&_a:hover]:underline [&_button:hover]:underline" data-testid={testId}>{children}</p>;
}
// A section's quiet lines, gathered in one block under the cards that hold
// something. Draws nothing when every line inside it draws nothing.
export function BrandQuietBlock({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-3 py-2.5 flex flex-col gap-1.5 min-w-0 [&:not(:has(p))]:hidden" data-testid={testId}>
      {children}
    </div>
  );
}

// One Refresh for a card that can be refreshed from several places (the
// Expansion score: news, a web search, the brand's own website). Each choice
// says where it reads from; the trigger shows which one is running.
export type BrandRefreshChoice = { key: string; label: string; hint: string; onSelect: () => void; pending?: boolean; disabled?: boolean };
export function BrandRefreshMenu({ choices, testId }: { choices: BrandRefreshChoice[]; testId?: string }) {
  const running = choices.find(choice => choice.pending);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={!!running} className={`${brandCardAction} inline-flex items-center gap-0.5`} data-testid={testId}>
          {running ? `Refreshing ${running.label.toLowerCase()}…` : "Refresh"}{!running && <ChevronDown className="w-3 h-3" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {choices.map(choice => (
          <DropdownMenuItem key={choice.key} disabled={choice.disabled} onSelect={() => choice.onSelect()} className="flex-col items-start gap-0" data-testid={`${testId || "brand-refresh"}-${choice.key}`}>
            <span className="text-sm">{choice.label}</span>
            <span className="text-[11px] text-muted-foreground">{choice.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
