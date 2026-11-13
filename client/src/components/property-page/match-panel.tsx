// The panel beside the plan while a person matches the plan to the tenancy
// schedule (the Match screen of the plan-led property page). It draws one
// PlanMatchBoard, which the host reads with usePlanMatchBoard
// (GET /api/plans/:id/match), and changes things only through the host's
// PlanMatchActions. The schedule is the list of units and the plan never adds
// one: an outline is linked to a schedule unit, kept as context (drawn in
// grey, not a unit) or marked "not a unit". Clicking on the plan belongs to
// the host, so "Find on plan" is handed to it and comes back as PlanPickState.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Pill, PillCount } from "@/components/ui/pill";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { rowPill } from "@/components/landsec/deal-clock";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PLAN_MATCH_METHOD_LABELS, bulkAcceptable, planMatchCounts, type PlanMatchBoard, type PlanMatchProposal, type PlanMatchRow } from "@shared/property-plan-match";
import { plainError, unitDisplayLabel, type PlanMatchActions } from "./use-property-page";

// The "find this unit on the plan" flow is owned by the host (it needs the canvas).
export interface PlanPickState { rowId: string; step: "click" | "tracing" | "confirm" | "saving"; error: string | null }

type PanelProps = {
  board: PlanMatchBoard;
  actions: PlanMatchActions;
  selectedProposalId: string | null;
  onSelectProposal: (id: string | null) => void;
  selectedOutlineId: string | null;
  onSelectOutline: (id: string | null) => void;
  pick: PlanPickState | null;
  onStartPick: (rowId: string) => void;
  onConfirmPick: () => void;
  onRetryPick: () => void;
  onCancelPick: () => void;
  onDone: () => void;
  // Dropped from a schedule unit's name, as on the rest of the page.
  propertyName?: string | null;
  className?: string;
};

// A schedule row with the name this page shows for it: "EVL01", where the
// schedule has "EVL01 Bluewater - Lower Level". The full name is the tooltip.
type Row = PlanMatchRow & { name: string };

type Tab = "check" | "matched" | "notdrawn";
const TABS: { key: Tab; label: string }[] = [
  { key: "check", label: "To check" },
  { key: "matched", label: "Matched" },
  { key: "notdrawn", label: "Not drawn" },
];

// The queue runs from the surest reading to the least sure: a suggestion the
// bulk button would take, any other suggestion, several possible units, none.
const queueRank = (proposal: PlanMatchProposal) =>
  bulkAcceptable(proposal) ? 0 : proposal.suggestedRowId ? 1 : proposal.possibleRowIds.length > 0 ? 2 : 3;
const CHECK_TAG = { label: "Check", tone: "border-amber-500/60 text-amber-700 dark:text-amber-400" };
const QUEUE_TAGS = [
  { label: "Suggested", tone: "border-emerald-600/60 text-emerald-700 dark:text-emerald-400" },
  CHECK_TAG,
  CHECK_TAG,
  { label: "No match", tone: "border-border text-muted-foreground" },
];

const CONTEXT_TITLE = "Draws it on the plan in grey. It is not a unit on the schedule.";
const PICK_WORDS = { tracing: "Finding the walls…", confirm: "Is the highlighted outline right?", saving: "Saving…" };
const naturally = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });
const sameText = (a: string | null, b: string | null) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
const joined = (...parts: Array<string | null | false>) => parts.filter(Boolean).join(" · ");
const fullName = (row: Row, floor?: boolean) => joined(row.label, row.tenant, !!floor && row.floor);

const microLabel = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const textAction = "text-left text-xs text-primary hover:underline disabled:pointer-events-none disabled:opacity-50";
const emptyLine = "py-6 text-center text-sm text-muted-foreground";
const amberNote = "mt-1 text-xs text-amber-700 dark:text-amber-400";
const rowButton = "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
// A long list scrolls inside its own box and keeps room for three rows under
// the selected card; a short one is as tall as its rows.
const listBox = (rows: number) =>
  cn("divide-y divide-border rounded-lg border border-border bg-background", rows > 3 ? "min-h-[7rem] overflow-y-auto" : "shrink-0");

function Num({ n }: { n: number }) {
  return <span className="font-mono tabular-nums">{n}</span>;
}

// "SU12 · Costa · Lower Level": a schedule unit, wherever one is named.
function RowText({ row, floor }: { row: Row; floor?: boolean }) {
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
// on this floor yet, the ones the scan thought possible first.
function RowPicker({ label, rows, possibleIds, disabled, onChoose, testId }: {
  label: string;
  rows: Row[];
  possibleIds?: string[];
  disabled: boolean;
  onChoose: (rowId: string) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const list = () => {
    const possible = [...new Set(possibleIds)].map(id => rows.find(row => row.id === id)).filter((row): row is Row => !!row);
    const others = possible.length ? rows.filter(row => !possible.includes(row)) : rows;
    const item = (row: Row) => (
      <CommandItem key={row.id} value={row.id} keywords={[fullName(row, true)]} disabled={disabled} onSelect={() => { setOpen(false); onChoose(row.id); }} data-testid={`${testId}-${row.id}`}>
        <span className="min-w-0 flex-1 truncate" title={fullName(row, true)}><RowText row={row} floor /></span>
        {row.outlinedElsewhere && <span className="shrink-0 text-[11px] text-muted-foreground">drawn on another floor</span>}
      </CommandItem>
    );
    return (
      <Command filter={wordsMatch} label="Schedule units">
        <CommandInput placeholder="Search unit, tenant or floor…" />
        <CommandList className="max-h-[260px]">
          <CommandEmpty>{rows.length ? "No units match." : "Every schedule unit has an outline on this floor."}</CommandEmpty>
          {possible.length > 0 && <CommandGroup heading="Possible">{possible.map(item)}</CommandGroup>}
          {others.length > 0 && <CommandGroup heading={possible.length ? "Other schedule units" : undefined}>{others.map(item)}</CommandGroup>}
        </CommandList>
      </Command>
    );
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled} data-testid={testId}>{label}</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        {open && list()}
      </PopoverContent>
    </Popover>
  );
}

export function PlanMatchPanel(props: PanelProps): JSX.Element {
  // Another floor is another piece of work: the open list, the search and any
  // half-given confirmation start again.
  return <MatchPanel key={props.board.plan.id} {...props} />;
}

function MatchPanel({ board, actions, selectedProposalId, onSelectProposal, selectedOutlineId, onSelectOutline, pick, onStartPick, onConfirmPick, onRetryPick, onCancelPick, onDone, propertyName, className }: PanelProps) {
  const { toast } = useToast();
  const { scan } = board;
  const busy = actions.busy;
  const counts = useMemo(() => planMatchCounts(board), [board]);
  const pickRowId = pick?.rowId ?? null;
  // With no scan to run and nothing to check, the work starts under Not drawn.
  const pickHint = !board.canScan && board.proposals.length === 0 && counts.rowsNotDrawn > 0;

  const [tab, setTab] = useState<Tab>(() => (pick ? "notdrawn" : selectedOutlineId ? "matched" : !selectedProposalId && pickHint ? "notdrawn" : "check"));
  const [search, setSearch] = useState("");
  const [bulkAsked, setBulkAsked] = useState("");
  const [removeAsked, setRemoveAsked] = useState<string | null>(null);

  // Schedule rows in natural order ("Unit 2" before "Unit 10"), as the unit list has them.
  const rows = useMemo<Row[]>(() => board.rows
    .map(row => ({ ...row, name: unitDisplayLabel(row.label, propertyName, row.floor) }))
    .sort((a, b) => naturally.compare(a.label, b.label)), [board.rows, propertyName]);
  const rowById = useMemo(() => new Map(rows.map(row => [row.id, row])), [rows]);
  const freeRows = useMemo(() => rows.filter(row => !row.outlinedHere), [rows]);
  const notDrawn = useMemo(() => rows.filter(row => !row.outlinedHere && !row.outlinedElsewhere), [rows]);
  const queue = useMemo(() => board.proposals.map(proposal => ({ proposal, rank: queueRank(proposal) })).sort((a, b) => a.rank - b.rank), [board.proposals]);
  // Linked outlines in schedule order, then the context ones.
  const saved = useMemo(() => {
    const order = new Map(rows.map((row, index) => [row.id, index]));
    const place = (rowId: string | null) => (rowId ? order.get(rowId) ?? rows.length : rows.length + 1);
    return [...board.outlines].sort((a, b) => place(a.scheduleRowId) - place(b.scheduleRowId));
  }, [board.outlines, rows]);
  const listed = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const found = needle ? notDrawn.filter(row => [row.label, row.tenant, row.floor, row.use].some(value => (value || "").toLowerCase().includes(needle))) : notDrawn;
    // The unit being found on the plan stays in the list whatever the search
    // says, and when the host started it for a unit drawn on another floor.
    const finding = pickRowId ? rowById.get(pickRowId) : undefined;
    return finding && !found.includes(finding) ? [finding, ...found] : found;
  }, [notDrawn, search, pickRowId, rowById]);

  const selected = (selectedProposalId && board.proposals.find(proposal => proposal.id === selectedProposalId)) || null;
  const suggested = (selected?.suggestedRowId && rowById.get(selected.suggestedRowId)) || null;
  const bulkKey = scan ? `${scan.id}:${counts.suggested}` : "";
  const confirmBulk = !!bulkKey && bulkAsked === bulkKey;
  const pickBusy = pick?.step === "tracing" || pick?.step === "saving";

  // The host also changes the selection when a shape is clicked on the plan:
  // open the list the chosen thing is in.
  useEffect(() => { if (selectedProposalId) setTab("check"); }, [selectedProposalId]);
  useEffect(() => { if (selectedOutlineId) setTab("matched"); setRemoveAsked(null); }, [selectedOutlineId]);
  useEffect(() => { if (pickRowId) setTab("notdrawn"); }, [pickRowId]);

  // Then keep it on screen. Only this panel's own boxes are scrolled, never
  // the page.
  const listsRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const currentRef = useRef<HTMLElement | null>(null);
  const keepCurrent = useCallback((element: HTMLElement | null) => { currentRef.current = element; }, []);
  const savedAt = selectedOutlineId ? saved.findIndex(outline => outline.id === selectedOutlineId) : -1;
  const inView = tab === "check" ? selectedProposalId : tab === "matched" ? `${selectedOutlineId}:${savedAt}` : pick ? `${pick.rowId}:${pick.step}` : null;
  useEffect(() => {
    const lists = listsRef.current, box = listRef.current, item = currentRef.current;
    if (!lists) return;
    // Bring from..to inside top..bottom with the least movement, its start first.
    const fit = (scroller: HTMLElement, top: number, bottom: number, from: number, to: number) => {
      if (from < top) scroller.scrollTop -= top - from;
      else if (to > bottom) scroller.scrollTop += Math.min(to - bottom, from - top);
    };
    const edges = (element: HTMLElement) => element.getBoundingClientRect();
    // The card comes first: on a short panel the progress and scan lines
    // scroll away to make room for it, and the queue takes what is left.
    if (tab === "check" && tabsRef.current && cardRef.current) fit(lists, edges(lists).top, edges(lists).bottom, edges(tabsRef.current).top, edges(box || cardRef.current).bottom);
    if (!box || !item) return;
    fit(box, Math.max(edges(box).top, edges(lists).top), Math.min(edges(box).bottom, edges(lists).bottom), edges(item).top, edges(item).bottom);
    if (tab !== "check") fit(lists, edges(lists).top, edges(lists).bottom, edges(item).top, edges(item).bottom);
  }, [tab, inView]);

  // One change at a time from this panel, and one place for the failure toast.
  const working = useRef(false);
  const act = async (failed: string, work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    try { await work(); }
    catch (error) { toast({ variant: "destructive", title: failed, description: plainError(error) }); }
    finally { working.current = false; }
  };
  // The proposal after this one in the queue, going round to the top; null when it is the last one left.
  const nextAfter = (proposalId: string) => {
    const at = queue.findIndex(entry => entry.proposal.id === proposalId);
    const rest = at < 0 ? queue : [...queue.slice(at + 1), ...queue.slice(0, at)];
    return rest[0]?.proposal.id ?? null;
  };
  // A request takes a moment. Someone who has chosen something else by the
  // time it comes back (another shape on the plan, a unit to find) keeps it.
  const latest = useRef({ proposal: selectedProposalId, outline: selectedOutlineId, finding: !!pick });
  latest.current = { proposal: selectedProposalId, outline: selectedOutlineId, finding: !!pick };
  const moveOn = (from: string, next: string | null) => {
    const now = latest.current;
    if (now.proposal ? now.proposal === from : !now.outline && !now.finding) onSelectProposal(next);
  };
  const acceptOnto = (proposal: PlanMatchProposal, scheduleRowId: string | null) => act("The outline was not saved", async () => {
    if (!scan) return;
    const next = nextAfter(proposal.id);
    await actions.accept({ scanId: scan.id, candidateId: proposal.id, scheduleRowId });
    moveOn(proposal.id, next);
  });
  const notAUnit = (proposal: PlanMatchProposal) => act("The outline was not changed", async () => {
    if (!scan) return;
    const next = nextAfter(proposal.id);
    await actions.dismiss({ scanId: scan.id, candidateId: proposal.id, dismissed: true });
    moveOn(proposal.id, next);
  });
  const acceptSuggested = () => act("The suggested matches were not saved", async () => {
    if (!scan) return;
    const { created, skipped } = await actions.acceptSuggested(scan.id);
    setBulkAsked("");
    toast({
      title: `${created} matched to the schedule`,
      description: skipped.length > 0 ? (
        <span className="block space-y-0.5">
          <span className="block"><Num n={skipped.length} /> not matched:</span>
          {skipped.slice(0, 3).map((entry, index) => <span key={index} className="block">{entry.label}: {entry.reason}</span>)}
          {skipped.length > 3 && <span className="block">and <Num n={skipped.length - 3} /> more</span>}
        </span>
      ) : undefined,
    });
  });
  const putBack = () => act("The outlines were not put back", async () => { if (scan) await actions.restoreDismissed(scan.id); });
  const startScan = () => act("The scan did not start", () => actions.startScan());
  const relink = (outlineId: string, scheduleRowId: string | null) => act("The outline was not changed", () => actions.relink(outlineId, scheduleRowId));
  const removeOutline = (outlineId: string) => act("The outline was not removed", async () => {
    await actions.removeOutline(outlineId);
    setRemoveAsked(null);
    if (latest.current.outline === outlineId) onSelectOutline(null);
  });

  // "Matched" counts what the line above calls matched; the context outlines are listed under it too.
  const tabCounts: Record<Tab, number> = { check: counts.toCheck, matched: counts.matched, notdrawn: counts.rowsNotDrawn };
  const reviewed = counts.matched + counts.toCheck;
  const matchedPercent = reviewed > 0 ? Math.round((counts.matched / reviewed) * 100) : 0;

  // The host gives the panel a height beside the plan and none where the two
  // stack (a phone), so it also caps itself: either way the lists scroll here.
  return (
    <div className={cn("flex h-full max-h-[85vh] min-h-0 flex-col gap-3 p-3", className)} data-testid="plan-match-panel">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <h2 className="min-w-0 break-words text-sm font-semibold leading-snug">Match {board.plan.floor} to the tenancy schedule</h2>
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onDone} data-testid="plan-match-done">Done</Button>
      </div>

      <div ref={listsRef} className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
        <div className="mb-3 shrink-0 space-y-3">
          <div className="space-y-1.5" data-testid="plan-match-progress">
            <p className="text-xs text-muted-foreground [&>span]:text-foreground">
              <Num n={counts.matched} /> matched · <Num n={counts.context} /> kept as context · <Num n={counts.toCheck} /> to check · <Num n={counts.rowsNotDrawn} /> {counts.rowsNotDrawn === 1 ? "schedule unit" : "schedule units"} not drawn
            </p>
            <div className="h-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Outlines matched" aria-valuemin={0} aria-valuemax={100} aria-valuenow={matchedPercent} aria-valuetext={`${counts.matched} of ${reviewed} matched`}>
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${matchedPercent}%` }} />
            </div>
          </div>

          {scan?.status === "running" && (
            <div className="text-xs" role="status" data-testid="plan-match-scanning">
              <p className="flex items-center gap-1.5 font-medium">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                <span>Reading the plan…</span>
                {scan.total > 0 && <span className="ml-auto font-normal text-muted-foreground"><Num n={scan.completed} /> of <Num n={scan.total} /></span>}
              </p>
              {scan.message && <p className="mt-0.5 text-muted-foreground">{scan.message}</p>}
            </div>
          )}
          {board.canScan && (!scan || scan.status === "failed" || scan.status === "applied") && (
            <div className="space-y-1.5">
              {scan?.status === "failed" && <p className="text-xs text-destructive" role="alert">{scan.message || "The scan could not finish."}</p>}
              <Button type="button" size="sm" variant={scan ? "outline" : "default"} disabled={busy} onClick={startScan} data-testid="plan-match-scan">{scan ? "Scan again" : "Scan this plan for units"}</Button>
              <p className="text-[11px] leading-snug text-muted-foreground">The scan finds outlines on the plan and suggests which schedule unit each one is. Nothing is saved until you accept it.</p>
            </div>
          )}
          {pickHint && <p className="text-xs text-muted-foreground">Pick a unit under Not drawn and click it on the plan.</p>}
          {board.dismissed > 0 && scan && (
            <button type="button" className={textAction} disabled={busy} onClick={putBack} data-testid="plan-match-put-back">Put back <Num n={board.dismissed} /> marked not a unit</button>
          )}

          {counts.suggested > 0 && scan && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={confirmBulk ? acceptSuggested : () => setBulkAsked(bulkKey)} data-testid="plan-match-accept-suggested">
                {confirmBulk
                  ? <span>Yes, accept <Num n={counts.suggested} /></span>
                  : <span>Accept <Num n={counts.suggested} /> {counts.suggested === 1 ? "suggested match" : "suggested matches"}</span>}
              </Button>
              {confirmBulk && <Button type="button" size="sm" variant="ghost" onClick={() => setBulkAsked("")}>Cancel</Button>}
            </div>
          )}
        </div>

        <div ref={tabsRef} className="mb-2 shrink-0 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map(({ key, label }) => (
              <Pill key={key} active={tab === key} aria-pressed={tab === key} onClick={() => setTab(key)} data-testid={`plan-match-tab-${key}`}>
                {label} <PillCount n={tabCounts[key]} active={tab === key} />
              </Pill>
            ))}
          </div>
          {tab === "notdrawn" && notDrawn.length > 0 && (
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search unit, tenant or use…" aria-label="Search the units not drawn" className="h-11 md:h-8" data-testid="plan-match-search" />
          )}
        </div>

        {tab === "check" && (
          <>
            {selected && (
              <div ref={cardRef} className="mb-2 shrink-0 rounded-lg border border-border bg-background p-3" data-testid="plan-match-card">
                <p className={microLabel}>The plan prints</p>
                <p className="mt-0.5 break-words text-sm">
                  <span className="font-medium">{selected.label}</span>{selected.tenant && !sameText(selected.tenant, selected.label) && ` · ${selected.tenant}`}
                </p>
                {suggested && (
                  <div className="mt-2.5">
                    <p className={microLabel}>Suggested schedule unit</p>
                    <p className="mt-0.5 break-words text-sm" title={fullName(suggested, true)}><RowText row={suggested} floor /></p>
                    {selected.method && <p className="text-xs text-muted-foreground">{PLAN_MATCH_METHOD_LABELS[selected.method]}.</p>}
                    {selected.tenantDiffers && <p className={amberNote}>The plan prints {selected.tenant || selected.label}; the schedule has {suggested.tenant || "no tenant"}. The plan may be older than the schedule.</p>}
                    {selected.floorDiffers && <p className={amberNote}>The schedule puts this unit on {suggested.floor || "another floor"}.</p>}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {suggested && <Button type="button" size="sm" disabled={busy} onClick={() => acceptOnto(selected, suggested.id)} data-testid="plan-match-accept">Accept</Button>}
                  <RowPicker label={suggested ? "Choose another unit" : "Choose a unit"} rows={freeRows} possibleIds={selected.possibleRowIds} disabled={busy} onChoose={rowId => acceptOnto(selected, rowId)} testId="plan-match-choose" />
                  <Button type="button" size="sm" variant="outline" disabled={busy} title={CONTEXT_TITLE} onClick={() => acceptOnto(selected, null)} data-testid="plan-match-context">Keep as context</Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => notAUnit(selected)} data-testid="plan-match-dismiss">Not a unit</Button>
                </div>
              </div>
            )}
            {queue.length === 0 ? <p className={emptyLine}>Nothing left to check on this floor.</p> : (
              <ul ref={listRef} className={listBox(queue.length)} aria-label="Outlines to check">
                {queue.map(({ proposal, rank }) => {
                  const current = proposal.id === selectedProposalId;
                  const tenant = proposal.tenant && !sameText(proposal.tenant, proposal.label) ? proposal.tenant : null;
                  return (
                    <li key={proposal.id}>
                      <button type="button" ref={current ? keepCurrent : undefined} aria-current={current || undefined} onClick={() => onSelectProposal(proposal.id)} className={cn(rowButton, current && "bg-muted")} data-testid={`plan-match-proposal-${proposal.id}`}>
                        <span className="min-w-0 flex-1 truncate text-sm" title={tenant ? `${proposal.label} · ${tenant}` : proposal.label}>
                          <span className="font-medium">{proposal.label}</span>{tenant && ` · ${tenant}`}
                        </span>
                        <span className={cn(rowPill, "shrink-0", QUEUE_TAGS[rank].tone)}>{QUEUE_TAGS[rank].label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {tab === "matched" && (saved.length === 0 ? <p className={emptyLine}>No outlines saved on this floor yet.</p> : (
          <ul ref={listRef} className={listBox(saved.length)} aria-label="Saved outlines">
            {saved.map(outline => {
              const linked = !!outline.scheduleRowId;
              const row = (outline.scheduleRowId && rowById.get(outline.scheduleRowId)) || null;
              const current = outline.id === selectedOutlineId;
              return (
                <li key={outline.id} ref={current ? keepCurrent : undefined} className={cn(current && "bg-muted")}>
                  <button type="button" aria-expanded={current} onClick={() => onSelectOutline(outline.id)} className={rowButton} data-testid={`plan-match-outline-${outline.id}`}>
                    <span className="min-w-0 flex-1 truncate text-sm" title={row ? fullName(row) : outline.label || undefined}>
                      {row ? <RowText row={row} /> : linked ? <span className="font-medium">{outline.label || "Schedule unit"}</span> : <>Context{outline.label && ` · ${outline.label}`}</>}
                    </span>
                  </button>
                  {current && (removeAsked === outline.id ? (
                    <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
                      <p className="text-xs">Remove this outline?</p>
                      <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => removeOutline(outline.id)} data-testid="plan-match-remove-yes">Remove</Button>
                      <Button type="button" size="sm" variant="ghost" autoFocus onClick={() => setRemoveAsked(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 px-3 pb-3">
                      <RowPicker label={linked ? "Change unit" : "Link to a unit"} rows={freeRows} disabled={busy} onChoose={rowId => relink(outline.id, rowId)} testId="plan-match-relink" />
                      {linked && <Button type="button" size="sm" variant="outline" disabled={busy} title={CONTEXT_TITLE} onClick={() => relink(outline.id, null)} data-testid="plan-match-make-context">Make it context</Button>}
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setRemoveAsked(outline.id)} data-testid="plan-match-remove">Remove outline</Button>
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        ))}

        {tab === "notdrawn" && (listed.length === 0 ? (
          <p className={emptyLine}>{board.rows.length === 0 ? "No units on the tenancy schedule yet." : notDrawn.length === 0 ? "Every schedule unit is drawn." : "No units match."}</p>
        ) : (
          <ul ref={listRef} className={listBox(listed.length)} aria-label="Schedule units not drawn">
            {listed.map(row => {
              const finding = pick && pick.rowId === row.id ? pick : null;
              return (
                <li key={row.id} ref={finding ? keepCurrent : undefined} className={cn("px-3 py-1.5", finding && "bg-muted")} data-testid={`plan-match-row-${row.id}`}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm" title={fullName(row)}><RowText row={row} /></span>
                    {!finding && <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={busy || pickBusy} onClick={() => onStartPick(row.id)} data-testid={`plan-match-find-${row.id}`}>Find on plan</Button>}
                  </div>
                  {finding && (
                    <div className="mt-1.5 space-y-1.5 text-xs">
                      <p role="status" className={cn("flex items-center gap-1.5", pickBusy && "text-muted-foreground")}>
                        {pickBusy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />}
                        {finding.step === "click" ? `Click inside ${row.name} on the plan.` : PICK_WORDS[finding.step]}
                      </p>
                      {(finding.step === "click" || finding.step === "confirm") && (
                        <div className="flex flex-wrap gap-2">
                          {finding.step === "confirm" && <Button type="button" size="sm" disabled={busy} onClick={onConfirmPick} data-testid="plan-match-pick-save">Save outline</Button>}
                          {finding.step === "confirm" && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRetryPick} data-testid="plan-match-pick-retry">Try again</Button>}
                          <Button type="button" size="sm" variant="ghost" onClick={onCancelPick} data-testid="plan-match-pick-cancel">Cancel</Button>
                        </div>
                      )}
                      {finding.error && <p className="text-destructive" role="alert">{finding.error}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
      </div>
    </div>
  );
}
