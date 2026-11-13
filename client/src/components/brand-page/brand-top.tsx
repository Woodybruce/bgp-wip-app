// The top of a brand's page (Woody, 2026-11-12: "still looks a bit rubbish"):
// the pieces of the header line and the summary band. Presentational only;
// brand-profile-panel.tsx owns the data and the actions.
import { Fragment } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type BrandMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  testId?: string;
};

// Every housekeeping control on a brand's page sits in this one menu, with
// text labels. A menu item that opens a dialog runs after the menu has
// closed, so the two never fight over focus.
// iconOnly (the phone): the trigger is the three dots alone, so the row of
// actions and the menu fit on one line.
export function BrandMoreMenu({ items, iconOnly = false }: { items: BrandMenuItem[]; iconOnly?: boolean }) {
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {iconOnly
          ? <Button variant="outline" size="icon" className="h-8 w-8" aria-label="More" title="More" data-no-min-touch data-testid="button-brand-more"><MoreHorizontal /></Button>
          : <Button variant="outline" size="sm" data-testid="button-brand-more"><MoreHorizontal />More</Button>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {items.map(item => (
          <Fragment key={item.key}>
            {item.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              disabled={item.disabled}
              className={item.destructive ? "text-destructive focus:text-destructive" : undefined}
              onSelect={() => { setTimeout(item.onSelect, 0); }}
              data-testid={item.testId}
            >
              {item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The card title the landlord cards use: small uppercase label, mono count.
export function BandHeading({ children, count, className = "" }: { children: React.ReactNode; count?: number | null; className?: string }) {
  return (
    <h3 className={`text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 ${className}`}>
      {children}{count != null && <span className="font-mono tabular-nums normal-case tracking-normal">{count.toLocaleString("en-GB")}</span>}
    </h3>
  );
}

// One figure in "Working with BGP" (docs/DESIGN.md §8: value in mono, a small
// label under it). A figure that opens something is a button.
export function BandFigure({ value, suffix, label, tone = "text-foreground", onClick, title, testId }: {
  value: React.ReactNode; suffix?: string; label: string; tone?: string; onClick?: () => void; title?: string; testId?: string;
}) {
  const body = <>
    <span className={`block text-base leading-tight whitespace-nowrap ${tone}`}><span className="font-mono tabular-nums">{value}</span>{suffix && <span className="text-sm"> {suffix}</span>}</span>
    <span className="block text-[11px] uppercase leading-tight whitespace-nowrap text-muted-foreground mt-0.5">{label}</span>
  </>;
  return onClick
    ? <button type="button" onClick={onClick} title={title} className="text-left rounded-md -m-1 p-1 hover:bg-muted/60 transition-colors" data-testid={testId}>{body}</button>
    : <div className="-m-1 p-1" title={title} data-testid={testId}>{body}</div>;
}

// One rule for "Menu highlights" against "Best sellers", shared by the full
// card and the teaser in the summary band so the two can never disagree.
export function menuIntelKind(companyType: string | null | undefined, industry: string | null | undefined, intelType?: string | null) {
  const blob = `${companyType || ""} ${industry || ""}`.toLowerCase();
  const isFood = /(restaurant|cafe|café|food|f\s*&\s*b|fnb|bakery|coffee|qsr|fast.?food|dining|kitchen|pub|bar|brewery|hospitality|takeaway|dessert|ice.?cream|juice|smoothie|sandwich|pizza|burger|chicken|sushi|noodle|ramen)/.test(blob);
  const expectedKind: "menu" | "bestsellers" = isFood ? "menu" : "bestsellers";
  return {
    expectedKind,
    heading: expectedKind === "menu" ? "Menu highlights" : "Best sellers",
    labelKind: (intelType || expectedKind) === "menu" ? "Menu highlights" : "Best sellers",
  };
}

// "What they sell": the first few items of the menu card as one line, with a
// link to the full card. Draws nothing when there are no items.
// inline (the foot of the summary band): the heading and the items share one
// line where the band is wide enough, and wrap where it is not.
export function WhatTheySellLine({ items, labelKind, onShowAll, inline = false }: {
  items: Array<{ name: string }>; labelKind: string; onShowAll: () => void; inline?: boolean;
}) {
  if (!items.length) return null;
  const shown = items.slice(0, 4);
  return (
    <div className={inline ? "flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0" : undefined} data-testid="brand-what-they-sell">
      <BandHeading className={inline ? "shrink-0" : "mb-1"}>What they sell <span className="normal-case tracking-normal font-normal">· {labelKind}</span></BandHeading>
      <p className="text-sm leading-snug min-w-0">
        {shown.map((item, index) => (
          <Fragment key={`${item.name}-${index}`}>
            <span>{item.name}</span>
            <span className="text-muted-foreground">{index < shown.length - 1 ? " · " : items.length > shown.length ? " … " : " "}</span>
          </Fragment>
        ))}
        <button type="button" onClick={onShowAll} className="text-xs text-primary hover:underline whitespace-nowrap" data-testid="button-what-they-sell-all">Show all <span className="font-mono tabular-nums">{items.length}</span></button>
      </p>
    </div>
  );
}
