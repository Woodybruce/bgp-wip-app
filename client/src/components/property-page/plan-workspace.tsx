// The Plan tab of the plan-led property page
// (docs/property-page-rebuild-2026-11-13.md): the leasing plan with every unit
// coloured by its state, beside the one list of units, and a panel that opens
// on the unit you click with everything about it. The tenancy schedule is the
// list of units; the plan is a picture of them. "Match" is where a person ties
// the plan's outlines to schedule units.
//
// The page shapes itself to the building: no units, a setup card; one unit and
// no plan, that unit's panel is the page; several units and no plan, the list;
// a plan, the plan with the list beside it.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Map as MapIcon, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Pill, PillCount } from "@/components/ui/pill";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { PropertyPlansPanel } from "@/components/property-plans-panel";
import { pointInPolygon } from "@shared/plan-geometry";
import type { PropertyPlanPolygon } from "@shared/property-plan-scan";
import { UNIT_STATE_HEX, unitStateKey, unitStateLabel, type PropertyUnit, type UnitFilter, type UnitStateKey } from "@shared/property-units";
import { plainError, unitDisplayLabel, usePlanMatchActions, usePlanMatchBoard, usePropertyUnits } from "./use-property-page";
import { CONTEXT_HEX, PROPOSAL_HEX, UnitStateLegend } from "./unit-state";
import { PlanCanvas, type CanvasShape } from "./plan-canvas";
import { PropertyUnitList, filterUnits } from "./unit-list";
import { PropertyUnitPanel } from "./unit-panel";
import { PlanMatchPanel, type PlanPickState } from "./match-panel";

export interface PropertyPageViewer { staff: boolean; landsecView: boolean; restricted: boolean }

// What a click in "find this unit on the plan" produced, waiting for a yes:
// a scan proposal under the click, a grey context outline under it, or walls
// traced around the point.
type PickPreview =
  | { kind: "proposal"; candidateId: string; polygon: PropertyPlanPolygon }
  | { kind: "outline"; outlineId: string; polygon: PropertyPlanPolygon }
  | { kind: "traced"; polygon: PropertyPlanPolygon; imageKey: string };

const points = (polygon: PropertyPlanPolygon) => polygon.points.map(([x, y]) => ({ x, y }));
// A scan names an outline it could not read "Unlabelled 7": not worth drawing.
const printed = (label: string) => (/^unlabelled \d+$/i.test(label.trim()) ? null : label);

export function PropertyPlanWorkspace({ propertyId, viewer, onOpenSchedule, onUnitsLoaded }: {
  propertyId: string;
  viewer: PropertyPageViewer;
  onOpenSchedule: (scheduleRowId?: string) => void;
  // Tells the page what to call this tab: "Plan", "Units" or "Unit".
  onUnitsLoaded?: (summary: { units: number; plans: number }) => void;
}) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const feed = usePropertyUnits(propertyId);
  const plans = feed.data?.plans || [];
  const units = feed.data?.units || [];

  const [planId, setPlanId] = useState<string | null>(null);
  useEffect(() => {
    if (!plans.length) { if (planId) setPlanId(null); return; }
    if (!planId || !plans.some(p => p.id === planId)) setPlanId(plans[0].id);
  }, [plans, planId]);
  useEffect(() => { if (feed.data) onUnitsLoaded?.({ units: feed.data.units.length, plans: feed.data.plans.length }); }, [feed.data?.units.length, feed.data?.plans.length]);

  const board = usePlanMatchBoard(planId);
  const actions = usePlanMatchActions(propertyId, planId);

  const [mode, setMode] = useState<"view" | "match">("view");
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [hoverUnitId, setHoverUnitId] = useState<string | null>(null);
  const [filter, setFilter] = useState<UnitFilter>("all");
  const [search, setSearch] = useState("");
  // The shape the plan should bring into view; the key lets the same one be asked for again.
  const [focus, setFocus] = useState<{ id: string; key: number } | null>(null);
  const focusOn = useCallback((id: string) => setFocus(previous => ({ id, key: (previous?.key || 0) + 1 })), []);
  // The unit last opened stays marked in the list after its panel is closed.
  const [lastUnitId, setLastUnitId] = useState<string | null>(null);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [selectedOutlineId, setSelectedOutlineId] = useState<string | null>(null);
  const [pick, setPick] = useState<PlanPickState | null>(null);
  const [preview, setPreview] = useState<PickPreview | null>(null);
  // Each pick has a number, so a trace that comes back after the pick was
  // cancelled, restarted or left behind on another floor is thrown away.
  const pickTurn = useRef(0);
  const [plansOpen, setPlansOpen] = useState(false);

  // Leaving a floor or the match screen drops whatever was half chosen there.
  useEffect(() => { pickTurn.current++; setSelectedProposalId(null); setSelectedOutlineId(null); setPick(null); setPreview(null); }, [planId, mode]);
  useEffect(() => { setSelectedUnitId(null); setMode("view"); setFilter("all"); setSearch(""); }, [propertyId]);
  // A unit that has gone from the feed (archived, merged) cannot stay open,
  // nor a proposal or outline that has left the board (accepted, removed).
  useEffect(() => { if (selectedUnitId && feed.data && !units.some(u => u.id === selectedUnitId)) setSelectedUnitId(null); }, [feed.data, selectedUnitId]);
  useEffect(() => {
    if (!board.data) return;
    if (selectedProposalId && !board.data.proposals.some(p => p.id === selectedProposalId)) setSelectedProposalId(null);
    if (selectedOutlineId && !board.data.outlines.some(o => o.id === selectedOutlineId)) setSelectedOutlineId(null);
  }, [board.data, selectedProposalId, selectedOutlineId]);
  // A row that goes away under the pointer never says the pointer left it.
  useEffect(() => { setHoverUnitId(null); }, [mode, selectedUnitId, planId]);

  // Links from other screens: #tenancy-unit-<row id> (the deal page),
  // #plan-tenancy-<row id> and #plan-unit-<unit name> (the schedule's "view on
  // plan" and the brief). Each opens the unit, on the floor it is drawn on.
  useEffect(() => {
    if (!feed.data) return;
    const open = () => {
      const byRow = /^#(?:tenancy-unit|plan-tenancy)-(.+)$/.exec(window.location.hash);
      const byName = /^#plan-unit-(.+)$/.exec(window.location.hash);
      if (!byRow && !byName) return;
      let wanted = "";
      try { wanted = decodeURIComponent((byRow || byName)![1]); } catch { return; }
      const unit = byRow
        ? feed.data!.units.find(u => u.scheduleRowId === wanted)
        : feed.data!.units.find(u => u.label.trim().toLowerCase() === wanted.trim().toLowerCase());
      if (!unit) return;
      setMode("view");
      setSelectedUnitId(unit.id);
      const outline = unit.outlines[0];
      setLastUnitId(unit.id);
      if (outline) { setPlanId(outline.planId); focusOn(`outline:${outline.outlineId}`); }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [propertyId, !!feed.data]);

  const unitByRow = useMemo(() => new Map(units.filter(u => u.scheduleRowId).map(u => [u.scheduleRowId as string, u])), [units]);
  // The plan dims what the list hides, a beat behind the typing: redrawing
  // every outline on each key would hold the search box up.
  const planSearch = useDeferredValue(search);
  const shown = useMemo(() => new Set(filterUnits(units, filter, planSearch).map(u => u.id)), [units, filter, planSearch]);
  const filtering = filter !== "all" || !!planSearch.trim();
  const selectedUnit = selectedUnitId ? units.find(u => u.id === selectedUnitId) || null : null;
  const propertyName = feed.data?.property.name || null;
  // "WVL22 Bluewater - Lower Level" is "WVL22" on Bluewater's own page.
  const shortLabel = useCallback((label: string, floor?: string | null) => unitDisplayLabel(label, propertyName, floor), [propertyName]);
  const rowLabel = useCallback((rowId: string) => {
    const row = board.data?.rows.find(r => r.id === rowId);
    return row ? shortLabel(row.label, row.floor) : "this unit";
  }, [board.data, shortLabel]);

  const { shapes, stateCounts, contextCount } = useMemo(() => {
    const list: CanvasShape[] = [];
    const counts: Partial<Record<UnitStateKey, number>> = {};
    let context = 0;
    for (const outline of board.data?.outlines || []) {
      const unit: PropertyUnit | undefined = outline.scheduleRowId ? unitByRow.get(outline.scheduleRowId) : undefined;
      if (!unit) {
        context++;
        list.push({ id: `outline:${outline.id}`, polygon: outline.polygon, fill: CONTEXT_HEX, stroke: CONTEXT_HEX, dim: mode === "view", label: null, title: `${outline.label || "Outline"}: context, not a unit on the schedule` });
        continue;
      }
      const state = unitStateKey(unit);
      counts[state] = (counts[state] || 0) + 1;
      list.push({
        id: `outline:${outline.id}`, polygon: outline.polygon, fill: UNIT_STATE_HEX[state], stroke: UNIT_STATE_HEX[state],
        dim: mode === "view" && filtering && !shown.has(unit.id),
        label: shortLabel(unit.label, unit.floor),
        title: `${shortLabel(unit.label, unit.floor)}: ${unit.tenant.name ? `${unit.tenant.name}, ` : ""}${unitStateLabel(state).toLowerCase()}`,
      });
    }
    if (mode === "match") for (const proposal of board.data?.proposals || []) {
      list.push({ id: `proposal:${proposal.id}`, polygon: proposal.polygon, fill: PROPOSAL_HEX, stroke: PROPOSAL_HEX, dashed: true, dim: !proposal.suggestedRowId && !proposal.possibleRowIds.length, label: printed(proposal.label), title: printed(proposal.label) ? `Found by the scan: the plan prints ${proposal.label}` : "Found by the scan: nothing readable is printed here" });
    }
    return { shapes: list, stateCounts: counts, contextCount: context };
  }, [board.data, unitByRow, mode, filtering, shown, shortLabel]);

  const outlineOfUnit = (unit: PropertyUnit | null) => unit?.outlines.find(o => o.planId === planId) || null;
  const selectedShapeId = mode === "match"
    ? (selectedProposalId ? `proposal:${selectedProposalId}` : selectedOutlineId ? `outline:${selectedOutlineId}` : null)
    : (outlineOfUnit(selectedUnit) ? `outline:${outlineOfUnit(selectedUnit)!.outlineId}` : null);
  const hoverUnit = hoverUnitId ? units.find(u => u.id === hoverUnitId) || null : null;
  const hoverShapeId = mode === "view" && outlineOfUnit(hoverUnit) ? `outline:${outlineOfUnit(hoverUnit)!.outlineId}` : null;

  const selectUnit = (unitId: string) => {
    setSelectedUnitId(unitId);
    const outline = units.find(u => u.id === unitId)?.outlines.find(o => o.planId === planId);
    setLastUnitId(unitId);
    if (outline) focusOn(`outline:${outline.outlineId}`);
  };
  const selectShape = (shapeId: string) => {
    const [kind, id] = [shapeId.slice(0, shapeId.indexOf(":")), shapeId.slice(shapeId.indexOf(":") + 1)];
    if (mode === "match") {
      if (kind === "proposal") { setSelectedProposalId(id); setSelectedOutlineId(null); }
      else { setSelectedOutlineId(id); setSelectedProposalId(null); }
      return;
    }
    const rowId = board.data?.outlines.find(o => o.id === id)?.scheduleRowId;
    const unit = rowId ? unitByRow.get(rowId) : undefined;
    if (unit) setSelectedUnitId(unit.id);
  };

  // "Find this unit on the plan": the click takes the scan's proposal under it
  // if there is one, a grey context outline if there is one, and otherwise
  // traces the walls around the point. Nothing is saved until Save outline.
  const startPick = (rowId: string) => { pickTurn.current++; setPreview(null); setPick({ rowId, step: "click", error: null }); };
  const cancelPick = () => { pickTurn.current++; setPick(null); setPreview(null); };
  const retryPick = () => { pickTurn.current++; setPreview(null); setPick(p => (p ? { ...p, step: "click", error: null } : p)); };
  const onPick = async (point: { x: number; y: number }) => {
    if (!pick || pick.step !== "click" || !board.data) return;
    const under = (polygon: PropertyPlanPolygon) => pointInPolygon(point, points(polygon));
    const outline = board.data.outlines.find(o => under(o.polygon));
    if (outline?.scheduleRowId) {
      setPick({ ...pick, error: `That outline is already ${rowLabel(outline.scheduleRowId)}. Change it under Matched.` });
      return;
    }
    if (outline) { setPreview({ kind: "outline", outlineId: outline.id, polygon: outline.polygon }); setPick({ ...pick, step: "confirm", error: null }); return; }
    const proposal = board.data.proposals.find(p => under(p.polygon));
    if (proposal) { setPreview({ kind: "proposal", candidateId: proposal.id, polygon: proposal.polygon }); setPick({ ...pick, step: "confirm", error: null }); return; }
    const turn = pickTurn.current;
    setPick({ ...pick, step: "tracing", error: null });
    try {
      const traced = await actions.trace(point);
      if (pickTurn.current !== turn) return;
      setPreview({ kind: "traced", polygon: traced.polygon, imageKey: traced.imageKey });
      setPick(p => (p ? { ...p, step: "confirm", error: null } : p));
    } catch (error) {
      if (pickTurn.current !== turn) return;
      setPick(p => (p ? { ...p, step: "click", error: plainError(error) } : p));
    }
  };
  const confirmPick = async () => {
    if (!pick || !preview || pick.step !== "confirm") return;
    const rowId = pick.rowId, label = rowLabel(rowId);
    setPick({ ...pick, step: "saving", error: null });
    try {
      if (preview.kind === "proposal") {
        if (!board.data?.scan) throw new Error("Scan the plan again before saving this outline");
        await actions.accept({ scanId: board.data.scan.id, candidateId: preview.candidateId, scheduleRowId: rowId });
      } else if (preview.kind === "outline") {
        await actions.relink(preview.outlineId, rowId);
      } else {
        await actions.saveTraced({ polygon: preview.polygon, imageKey: preview.imageKey, scheduleRowId: rowId, label });
      }
      setPick(null); setPreview(null);
      toast({ title: `${label} is on the plan` });
    } catch (error) {
      setPick(p => (p ? { ...p, step: "confirm", error: plainError(error) } : p));
    }
  };

  const showOnPlan = (targetPlanId: string, outlineId: string) => { setMode("view"); setPlanId(targetPlanId); focusOn(`outline:${outlineId}`); };
  // The pick starts after the switch to Match has cleared whatever was half chosen there.
  const [pendingPick, setPendingPick] = useState<string | null>(null);
  const findOnPlan = (rowId: string) => { setSelectedUnitId(null); setMode("match"); setPendingPick(rowId); };
  useEffect(() => { if (pendingPick && mode === "match") { startPick(pendingPick); setPendingPick(null); } }, [pendingPick, mode]);

  if (feed.isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-80" /><Skeleton className="h-[60vh] rounded-lg" /></div>;
  if (feed.isError || !feed.data) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm" data-testid="property-plan-workspace-error">
        <p>This property's units could not be loaded. {plainError(feed.error)}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => feed.refetch()}>Try again</Button>
      </div>
    );
  }

  const counts = feed.data.counts;
  const canEdit = !viewer.restricted;
  const dealHref = viewer.restricted || !(viewer.staff || viewer.landsecView) ? undefined : (dealId: string) => `/deals/${dealId}`;
  const plansDialog = (
    <Dialog open={plansOpen} onOpenChange={open => { setPlansOpen(open); if (!open) { void feed.refetch(); void board.refetch(); } }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Plans for this property</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Load a plan (PDF or image), rename a floor, or remove one. A PDF becomes one plan per page and the units on it are found for you to match.</p>
        {plansOpen && <PropertyPlansPanel propertyId={propertyId} bare />}
      </DialogContent>
    </Dialog>
  );
  const loadPlanButton = canEdit && (
    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setPlansOpen(true)} data-testid="property-plans-manage">
      <Upload className="w-3.5 h-3.5" />{plans.length ? "Plans" : "Load a plan"}
    </Button>
  );
  const unitPanel = (unit: PropertyUnit, variant: "side" | "page") => (
    <PropertyUnitPanel
      propertyId={propertyId} propertyName={propertyName} unit={unit} plans={plans} viewer={viewer} variant={variant}
      onClose={variant === "side" ? () => setSelectedUnitId(null) : undefined}
      onShowOnPlan={plans.length ? showOnPlan : undefined}
      onFindOnPlan={canEdit && plans.length ? findOnPlan : undefined}
      onOpenSchedule={rowId => onOpenSchedule(rowId)}
    />
  );
  const unplaced = feed.data.unplacedDeals.length > 0 && (
    <p className="text-[11px] text-muted-foreground" data-testid="property-unplaced-deals">
      {feed.data.unplacedDeals.length === 1 ? "1 open deal on this property is" : `${feed.data.unplacedDeals.length} open deals on this property are`} not tied to a unit:{" "}
      {feed.data.unplacedDeals.slice(0, 6).map((deal, i) => {
        const text = `${deal.ref != null ? `#${deal.ref} ` : ""}${deal.tenant || deal.name || "Deal"}`;
        return <span key={deal.id}>{i > 0 && ", "}{dealHref ? <Link href={dealHref(deal.id)} className="hover:underline text-foreground">{text}</Link> : text}</span>;
      })}
      {feed.data.unplacedDeals.length > 6 && ` and ${feed.data.unplacedDeals.length - 6} more`}.
    </p>
  );
  const list = (dense: boolean, className?: string) => (
    <PropertyUnitList
      feed={feed.data!} selectedUnitId={selectedUnitId ?? lastUnitId} onSelectUnit={selectUnit} onHoverUnit={setHoverUnitId}
      filter={filter} onFilterChange={setFilter} search={search} onSearchChange={setSearch}
      dense={dense} dealHref={dealHref} className={className}
    />
  );

  // No units yet: say what the page needs, in the order it needs it.
  if (units.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 space-y-3 max-w-2xl" data-testid="property-plan-setup">
        <h2 className="text-base font-semibold">No units recorded yet</h2>
        <p className="text-sm text-muted-foreground">The tenancy schedule is this property's list of units. Add the units there first, one line each, even if all you know is the unit's name. A plan can then be loaded and each unit found on it.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onOpenSchedule()} data-testid="property-setup-open-schedule">Open the tenancy schedule</Button>
          {loadPlanButton}
        </div>
        {plans.length > 0 && <p className="text-xs text-muted-foreground">{plans.length === 1 ? "A plan is" : `${plans.length} plans are`} loaded. Units can be matched to {plans.length === 1 ? "it" : "them"} once they are on the schedule.</p>}
        {unplaced}
        {plansDialog}
      </div>
    );
  }

  // One unit, no plan: the unit is the page.
  if (units.length === 1 && plans.length === 0) {
    return (
      <div className="space-y-3" data-testid="property-single-unit">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">This property has one unit, so everything about it is on this page.</p>
          {loadPlanButton}
        </div>
        {unitPanel(units[0], "page")}
        {unplaced}
        {plansDialog}
      </div>
    );
  }

  // Several units, no plan: the list, with the unit panel opening beside it.
  if (plans.length === 0) {
    return (
      <div className="space-y-3" data-testid="property-units-only">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-muted-foreground">No plan is loaded for this property. Load one to see these units drawn on it.</p>
          {loadPlanButton}
        </div>
        {list(false)}
        {unplaced}
        <Sheet open={!!selectedUnit} onOpenChange={open => { if (!open) setSelectedUnitId(null); }}>
          <SheetContent hideClose side={isMobile ? "bottom" : "right"} className={isMobile ? "h-[88vh] p-0" : "w-full sm:max-w-xl p-0"}>
            <SheetTitle className="sr-only">Unit</SheetTitle>
            {selectedUnit && unitPanel(selectedUnit, "side")}
          </SheetContent>
        </Sheet>
        {plansDialog}
      </div>
    );
  }

  const plan = plans.find(p => p.id === planId) || plans[0];
  const matching = mode === "match";
  const onThisFloor = (board.data?.outlines || []).filter(o => o.scheduleRowId).length;
  const waiting = plan.proposals;

  return (
    <div className="space-y-3" data-testid="property-plan-workspace" data-mode={mode}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex flex-wrap gap-1.5" data-testid="property-plan-floors">
          {plans.map(p => (
            <Pill key={p.id} active={p.id === plan.id} onClick={() => setPlanId(p.id)} data-testid={`property-plan-floor-${p.id}`}>
              {p.floor} <PillCount n={p.outlines - p.unlinkedOutlines} active={p.id === plan.id} />
            </Pill>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">{counts.onPlan}</span> of <span className="font-mono tabular-nums">{counts.units}</span> units drawn on {plans.length === 1 ? "the plan" : "the plans"}
          {counts.proposals > 0 && <> · <span className="font-mono tabular-nums">{counts.proposals}</span> outlines found and waiting to be matched</>}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {canEdit && !matching && (
            <Button variant={waiting > 0 || counts.onPlan === 0 ? "default" : "outline"} size="sm" className="h-7 gap-1.5 text-xs" onClick={() => { setSelectedUnitId(null); setMode("match"); }} data-testid="property-plan-match">
              <MapIcon className="w-3.5 h-3.5" />Match plan to schedule{waiting > 0 ? ` (${waiting})` : ""}
            </Button>
          )}
          {loadPlanButton}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px] gap-3 items-start">
        <div className="min-w-0 space-y-2">
          {board.isError ? (
            <div className="rounded-lg border border-border bg-card p-4 text-sm">
              <p>This plan could not be loaded. {plainError(board.error)}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => board.refetch()}>Try again</Button>
            </div>
          ) : (
            <PlanCanvas
              key={`${plan.id}:${mode}`}
              planId={plan.id} floor={plan.floor} width={board.data?.plan.width ?? null} height={board.data?.plan.height ?? null}
              shapes={shapes} selectedId={selectedShapeId} hoverId={hoverShapeId}
              onSelect={selectShape} focusId={focus?.id || null} focusKey={focus?.key || 0}
              pick={pick && (pick.step === "click" || pick.step === "tracing") ? { hint: `Click inside ${rowLabel(pick.rowId)} on the plan`, busy: pick.step === "tracing", onPick } : null}
              preview={preview?.polygon || null}
              className="h-[46vh] lg:h-[calc(100vh-400px)] min-h-[320px] lg:min-h-[440px]"
            />
          )}
          <UnitStateLegend counts={stateCounts}>
            {contextCount > 0 && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: CONTEXT_HEX }} />Context, not a unit <span className="font-mono tabular-nums">{contextCount}</span></span>}
            {matching && (board.data?.proposals.length || 0) > 0 && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: PROPOSAL_HEX }} />Found by the scan, to check <span className="font-mono tabular-nums">{board.data!.proposals.length}</span></span>}
            {!matching && onThisFloor === 0 && board.data && <span>Nothing on {plan.floor} is matched to the schedule yet.{canEdit ? " Use Match plan to schedule." : ""}</span>}
          </UnitStateLegend>
        </div>

        <div className="relative min-w-0 lg:h-[calc(100vh-400px)] lg:min-h-[440px]">
          {matching ? (
            board.data
              ? <PlanMatchPanel
                  board={board.data} actions={actions}
                  selectedProposalId={selectedProposalId} onSelectProposal={id => { setSelectedProposalId(id); setSelectedOutlineId(null); if (id) focusOn(`proposal:${id}`); }}
                  selectedOutlineId={selectedOutlineId} onSelectOutline={id => { setSelectedOutlineId(id); setSelectedProposalId(null); if (id) focusOn(`outline:${id}`); }}
                  pick={pick} onStartPick={startPick} onConfirmPick={confirmPick} onRetryPick={retryPick} onCancelPick={cancelPick}
                  onDone={() => setMode("view")}
                  className="h-full rounded-lg border border-border bg-card"
                />
              : <Skeleton className="h-64 rounded-lg" />
          ) : (
            <>
              {/* The list stays laid out under an open unit, so it is already at that unit when the panel closes. */}
              <div className={`h-full flex flex-col gap-2 ${selectedUnit && !isMobile ? "invisible max-lg:hidden" : ""}`}>
                {list(true, "lg:flex-1 lg:min-h-0 max-h-[640px] lg:max-h-none")}
                {unplaced}
              </div>
              {selectedUnit && !isMobile && <div className="rounded-lg border border-border bg-card overflow-hidden lg:absolute lg:inset-0">{unitPanel(selectedUnit, "side")}</div>}
            </>
          )}
        </div>
      </div>

      {isMobile && !matching && (
        <Sheet open={!!selectedUnit} onOpenChange={open => { if (!open) setSelectedUnitId(null); }}>
          <SheetContent hideClose side="bottom" className="h-[88vh] p-0">
            <SheetTitle className="sr-only">Unit</SheetTitle>
            {selectedUnit && unitPanel(selectedUnit, "side")}
          </SheetContent>
        </Sheet>
      )}
      {plansDialog}
    </div>
  );
}
