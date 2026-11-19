// Editing what is drawn on the plan, on the Plan tab of the plan-led property
// page. A scan's outlines are saved the moment it finishes, each linked to the
// schedule unit the plan's number or tenant name names, the rest unlinked and
// grey (Woody, 2026-11-16: "all done immediately and then there is the
// ability to edit"). OutlinePanel opens on a grey outline clicked on the plan:
// link it to a unit, or remove it. Once linked it says so, with the unit to
// open and the next grey outline to go to. It changes things only through the
// host's PlanMatchActions, and the plan never adds a unit to the schedule.
// RowPicker, the schedule-unit chooser, is the unit panel's too.
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { PlanMatchBoard, PlanMatchOutline, PlanMatchRow } from "@shared/property-plan-match";
import { plainError, unitDisplayLabel, type PlanMatchActions } from "./use-property-page";

// A schedule row with the name this page shows for it: "EVL01", where the
// schedule has "EVL01 Bluewater - Lower Level". The full name is the tooltip.
export type PlanRow = PlanMatchRow & { name: string };

const naturally = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });
const joined = (...parts: Array<string | null | false | undefined>) => parts.filter(Boolean).join(" · ");
const fullName = (row: PlanRow, floor?: boolean) => joined(row.label, row.tenant, !!floor && row.floor);
const sameText = (a: string | null, b: string | null) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
// A key held down lands on whatever the first press put there; it is not a choice.
const heldEnter = (event: KeyboardEvent) => { if (event.repeat && event.key === "Enter") event.preventDefault(); };
// The second click of a double click lands on what the first put there ("Remove" after "Remove from plan").
const secondClick = (event: { detail: number }) => event.detail > 1;
const microLabel = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

// The schedule rows, in natural order ("Unit 2" before "Unit 10") and named as the page names them.
export function usePlanRows(board: PlanMatchBoard | undefined, propertyName: string | null | undefined): PlanRow[] {
  return useMemo(() => (board?.rows || [])
    .map(row => ({ ...row, name: unitDisplayLabel(row.label, propertyName, row.floor) }))
    .sort((a, b) => naturally.compare(a.label, b.label)), [board?.rows, propertyName]);
}

// What the plan prints where an outline sits: "U113 · Starbucks".
export function printedText(printed: PlanMatchOutline["printed"]): string | null {
  if (!printed) return null;
  const label = (printed.label || "").trim();
  if (!label || /^unlabelled \d+$/i.test(label)) return printed.tenant || null;
  return joined(label, printed.tenant && !sameText(printed.tenant, label) && printed.tenant) || null;
}

// "SU12 · Costa · Lower Level": a schedule unit, wherever one is named.
function RowText({ row, floor }: { row: PlanRow; floor?: boolean }) {
  const rest = joined(row.tenant, !!floor && row.floor);
  return <><span className="font-medium">{row.name}</span>{rest && ` · ${rest}`}</>;
}

// Every word typed has to be in the unit, its tenant or its floor. cmdk's own
// fuzzy scoring finds "SU12" in half a schedule.
const wordsMatch = (_value: string, search: string, keywords?: string[]) => {
  const text = (keywords || []).join(" ").toLowerCase();
  return search.toLowerCase().split(/\s+/).every(word => text.includes(word)) ? 1 : 0;
};

// The schedule units an outline can be linked to: every row with no outline
// on this floor yet, the ones its printed number or name could be first (or,
// for an outline drawn by hand, the ones the schedule puts on this floor).
export function RowPicker({ label, rows, possibleIds, possibleHeading = "Possible", primary = false, disabled, onChoose, testId }: {
  label: string;
  rows: PlanRow[];
  possibleIds?: string[];
  possibleHeading?: string;
  primary?: boolean;               // the step's main action, drawn as a filled button
  disabled: boolean;
  onChoose: (rowId: string) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = () => {
    const possible = [...new Set(possibleIds)].map(id => rows.find(row => row.id === id)).filter((row): row is PlanRow => !!row);
    const others = possible.length ? rows.filter(row => !possible.includes(row)) : rows;
    // The focus goes back to the button before the choice is acted on, so it is this button that gets it back afterwards.
    const item = (row: PlanRow) => (
      <CommandItem key={row.id} value={row.id} keywords={[fullName(row, true)]} disabled={disabled} onSelect={() => { setOpen(false); trigger.current?.focus(); onChoose(row.id); }} data-testid={`${testId}-${row.id}`}>
        <span className="min-w-0 flex-1 truncate" title={fullName(row, true)}><RowText row={row} floor /></span>
        {row.outlinedElsewhere && <span className="shrink-0 text-[11px] text-muted-foreground">drawn on another floor</span>}
      </CommandItem>
    );
    return (
      <Command filter={wordsMatch} label="Schedule units" onKeyDown={heldEnter}>
        <CommandInput placeholder="Search unit, tenant or floor…" />
        <CommandList className="max-h-[260px]">
          <CommandEmpty>{rows.length ? "No units match." : "Every schedule unit has an outline on this floor."}</CommandEmpty>
          {possible.length > 0 && <CommandGroup heading={possibleHeading}>{possible.map(item)}</CommandGroup>}
          {others.length > 0 && <CommandGroup heading={possible.length ? "Other schedule units" : undefined}>{others.map(item)}</CommandGroup>}
        </CommandList>
      </Command>
    );
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button ref={trigger} type="button" size="sm" variant={primary ? "default" : "outline"} className={primary ? "h-7 text-xs" : undefined} disabled={disabled} data-testid={testId}>{label}</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        {open && list()}
      </PopoverContent>
    </Popover>
  );
}

export function OutlinePanel({ outline, floor, rows, actions, unlinkedCount, onNext, onOpenUnit, onClose, className }: {
  outline: PlanMatchOutline;
  floor: string;
  rows: PlanRow[];
  actions: PlanMatchActions;
  unlinkedCount: number;           // grey outlines on this floor, this one included while it is grey
  onNext: (() => void) | null;     // the next grey outline on this floor, when there is another
  onOpenUnit: (scheduleRowId: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const { toast } = useToast();
  const [removeAsked, setRemoveAsked] = useState(false);
  useEffect(() => setRemoveAsked(false), [outline.id]);
  const busy = actions.busy;
  const rowById = useMemo(() => new Map(rows.map(row => [row.id, row])), [rows]);
  const freeRows = useMemo(() => rows.filter(row => !row.outlinedHere), [rows]);
  const linked = (outline.scheduleRowId && rowById.get(outline.scheduleRowId)) || null;
  const printed = printedText(outline.printed) || (outline.label && !/^unlabelled \d+$/i.test(outline.label) ? outline.label : null);
  // Up to three units it could be, as one press each; the picker lists them first too.
  const likely = outline.possibleRowIds.map(id => rowById.get(id)).filter((row): row is PlanRow => !!row && !row.outlinedHere).slice(0, 3);
  const others = unlinkedCount - (linked ? 0 : 1);

  const act = async (failed: string, work: () => Promise<void>) => {
    try { await work(); } catch (error) { toast({ variant: "destructive", title: failed, description: plainError(error) }); }
  };
  const linkTo = (rowId: string) => act("The outline was not linked", () => actions.relink(outline.id, rowId));
  const unlink = () => act("The outline was not changed", () => actions.relink(outline.id, null));
  const remove = () => act("The outline was not removed", async () => { await actions.removeOutline(outline.id); onClose(); });

  return (
    <div className={cn("flex flex-col gap-3 p-3", className)} data-testid="plan-outline-panel">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-sm font-semibold leading-snug">Outline on {floor}</h2>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close" onClick={onClose} data-testid="plan-outline-close"><X className="h-4 w-4" /></Button>
      </div>
      {printed && (
        <div>
          <p className={microLabel}>The plan prints</p>
          <p className="mt-0.5 break-words text-sm">{printed}</p>
        </div>
      )}
      {linked ? (
        <div className="space-y-2">
          <div>
            <p className={microLabel}>Linked to</p>
            <p className="mt-0.5 break-words text-sm" title={fullName(linked, true)}><RowText row={linked} floor /></p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => onOpenUnit(linked.id)} data-testid="plan-outline-open-unit">Open the unit</Button>
            <RowPicker label="Change unit" rows={freeRows} disabled={busy} onChoose={linkTo} testId="plan-outline-change" />
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={unlink} data-testid="plan-outline-unlink">Unlink</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Not linked to a unit on the tenancy schedule.</p>
          {likely.length > 0 && (
            <div className="space-y-1.5">
              <p className={microLabel}>{likely.length === 1 ? "Is it this unit?" : "Is it one of these?"}</p>
              <div className="flex flex-wrap gap-2">
                {likely.map(row => (
                  <Button key={row.id} type="button" size="sm" variant="outline" disabled={busy} title={fullName(row, true)} onClick={() => linkTo(row.id)} data-testid={`plan-outline-likely-${row.id}`}>
                    <span className="max-w-[16rem] truncate"><RowText row={row} /></span>
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <RowPicker label={likely.length ? "Another unit" : "Choose a unit"} rows={freeRows} possibleIds={outline.possibleRowIds} disabled={busy} onChoose={linkTo} testId="plan-outline-choose" />
          </div>
        </div>
      )}
      {removeAsked ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs">Remove this outline from the plan? The tenancy schedule is not changed.</p>
          <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={event => { if (!secondClick(event)) void remove(); }} data-testid="plan-outline-remove-yes">Remove</Button>
          <Button type="button" size="sm" variant="ghost" autoFocus onClick={() => setRemoveAsked(false)}>Cancel</Button>
        </div>
      ) : (
        <div>
          <Button type="button" size="sm" variant="ghost" className="-ml-2 text-muted-foreground" disabled={busy} onClick={() => setRemoveAsked(true)} data-testid="plan-outline-remove">Remove from plan</Button>
        </div>
      )}
      {(others > 0 || onNext) && (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
          <span><span className="font-mono tabular-nums">{others}</span> {linked ? "" : "other "}{others === 1 ? "outline" : "outlines"} not linked on {floor}</span>
          {onNext && <Button type="button" size="sm" variant="outline" onClick={onNext} data-testid="plan-outline-next">Next not linked</Button>}
        </div>
      )}
    </div>
  );
}
