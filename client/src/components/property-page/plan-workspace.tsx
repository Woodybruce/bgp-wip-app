// The Plan tab of the plan-led property page
// (docs/property-page-rebuild-2026-11-13.md): the leasing plan with every unit
// coloured by its state, beside the one list of units, and a panel that opens
// on the unit you click with everything about it. The tenancy schedule is the
// list of units; the plan is a picture of them.
//
// Loading, scanning and matching a plan all happen here (Woody, 2026-11-16:
// "fold the whole matching units to tenancy schedule and upload scan process
// into the main plan page"). A scan's outlines are saved the moment it
// finishes, each linked to the schedule unit the plan's number or tenant name
// names and the rest grey, so nothing waits to be checked. Editing is on the
// plan: a grey outline opens its own panel (link it, remove it), a unit's
// panel changes, unlinks or removes its outline, and "Find it on the plan"
// draws a unit that is not there yet (click inside it, or draw its corners).
// Where the scan missed units, "Draw a unit" above the plan works the other
// way round, as the lease advisory plans do (Woody, 2026-11-19: "draw a unit
// and allocate to the tenancy schedule where the scan hasn't worked"): draw
// the outline first, then choose its unit on the schedule, or save it grey.
//
// The page shapes itself to the building: no units, a setup card; one unit and
// no plan, that unit's panel is the page; several units and no plan, the list;
// a plan, the plan with the list beside it.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Crop, FileText, Loader2, PenTool, Pencil, ScanLine, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pill, PillCount } from "@/components/ui/pill";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiRequest } from "@/lib/queryClient";
import { UploadPlanButton, openOriginalPlanPdf } from "@/components/property-plans-panel";
import { PlanSourcesMenu } from "@/components/property-plan-sources";
import { PlanCropDialog, usePlanCrop } from "@/components/property-plan-crop";
import type { PropertyPlan } from "@/components/property-plan-types";
import { pointInPolygon } from "@shared/plan-geometry";
import type { PropertyPlanPolygon } from "@shared/property-plan-scan";
import { planMatchCounts, sameFloor } from "@shared/property-plan-match";
import { UNIT_STATE_HEX, unitStateKey, unitStateLabel, type PropertyUnit, type UnitFilter, type UnitStateKey } from "@shared/property-units";
import { plainError, unitDisplayLabel, usePlanMatchActions, usePlanMatchBoard, usePropertyUnits } from "./use-property-page";
import { CONTEXT_HEX, PROPOSAL_HEX, UnitStateLegend } from "./unit-state";
import { PlanCanvas, type CanvasShape } from "./plan-canvas";
import { PropertyUnitList, filterUnits } from "./unit-list";
import { PropertyUnitPanel } from "./unit-panel";
import { OutlinePanel, RowPicker, printedText, usePlanRows } from "./match-panel";
import { PropertyNewsPanel } from "@/pages/properties";
import { PropertyInstagram } from "./property-instagram";

export interface PropertyPageViewer { staff: boolean; landsecView: boolean; restricted: boolean }

// Finding a unit that is not on the plan: click inside it (the outline under
// the click is taken, else the walls around it are traced), or draw it corner
// by corner. Nothing is saved until Save outline. "Find it on the plan" starts
// from a schedule unit (rowId); "Draw a unit" starts from the plan (rowId
// null): its unit is chosen once the outline is there, or it is saved grey,
// and the bar then waits for the next unit (saved says what was just saved).
// how is the way the outline is being made, which Try again goes back to.
type Finding = { rowId: string | null; step: "click" | "tracing" | "confirm" | "corners" | "saving"; how: "click" | "corners"; error: string | null; saved?: string | null };
// What the click produced, waiting for a yes: a scan outline not yet saved, a
// saved outline (grey, or another unit's, which Save moves to this unit), or
// an outline traced or drawn.
type PickPreview =
  | { kind: "proposal"; candidateId: string; polygon: PropertyPlanPolygon }
  | { kind: "outline"; outlineId: string; fromRowId: string | null; polygon: PropertyPlanPolygon }
  | { kind: "traced"; polygon: PropertyPlanPolygon; imageKey: string };

const points = (polygon: PropertyPlanPolygon) => polygon.points.map(([x, y]) => ({ x, y }));
// A scan names an outline it could not read "Unlabelled 7": not worth drawing.
const printed = (label: string) => (/^unlabelled \d+$/i.test(label.trim()) ? null : label);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// Where an outline sits for reading order: its centre, in bands of a twentieth of the plan's height.
const readingKey = (polygon: PropertyPlanPolygon): [number, number] => {
  const pts = Array.isArray(polygon?.points) ? polygon.points : [];
  if (!pts.length) return [0, 0];
  return [Math.round((pts.reduce((sum, p) => sum + p[1], 0) / pts.length) * 20), pts.reduce((sum, p) => sum + p[0], 0) / pts.length];
};
const compareReading = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];
function Num({ n }: { n: number }) {
  return <span className="font-mono tabular-nums">{n}</span>;
}

export function PropertyPlanWorkspace({ propertyId, viewer, onOpenSchedule, onUnitsLoaded }: {
  propertyId: string;
  viewer: PropertyPageViewer;
  onOpenSchedule: (scheduleRowId?: string) => void;
  // Tells the page what to call this tab: "Plan", "Units" or "Unit".
  onUnitsLoaded?: (summary: { propertyId: string; units: number; plans: number }) => void;
}) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const feed = usePropertyUnits(propertyId);
  const plans = feed.data?.plans || [];
  const units = feed.data?.units || [];

  const [planId, setPlanId] = useState<string | null>(null);
  // A plan just loaded opens once the feed lists it.
  const wantedPlan = useRef<string | null>(null);
  useEffect(() => {
    if (!plans.length) { if (planId) setPlanId(null); return; }
    if (wantedPlan.current && plans.some(p => p.id === wantedPlan.current)) { setPlanId(wantedPlan.current); wantedPlan.current = null; return; }
    if (!planId || !plans.some(p => p.id === planId)) setPlanId(plans[0].id);
  }, [plans, planId]);
  useEffect(() => {
    if (feed.data && feed.data.property.id === propertyId) onUnitsLoaded?.({ propertyId, units: feed.data.units.length, plans: feed.data.plans.length });
  }, [propertyId, feed.data?.property.id, feed.data?.units.length, feed.data?.plans.length]);

  const board = usePlanMatchBoard(planId);
  const actions = usePlanMatchActions(propertyId, planId);
  // The plans as stored (image key, crop, PDF): what the plan's menu works on.
  const storedPlans = useQuery<{ plans: PropertyPlan[] }>({
    queryKey: ["/api/properties", propertyId, "plans"],
    queryFn: async () => (await apiRequest("GET", `/api/properties/${encodeURIComponent(propertyId)}/plans`)).json(),
    enabled: plans.length > 0,
    staleTime: 30 * 1000,
  });
  const planCrop = usePlanCrop(propertyId);

  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  // A grey outline opened from the plan; its panel sits where a unit's would.
  const [selectedOutlineId, setSelectedOutlineId] = useState<string | null>(null);
  const [hoverUnitId, setHoverUnitId] = useState<string | null>(null);
  const [filter, setFilter] = useState<UnitFilter>("all");
  // Beside the plan: the units, or the property's news (Woody, 2026-11-13: "news ... as a tab behind here").
  const [side, setSide] = useState<"units" | "news">("units");
  const [search, setSearch] = useState("");
  // The shape the plan should bring into view; the key lets the same one be asked for again.
  const [focus, setFocus] = useState<{ id: string; key: number } | null>(null);
  const focusKeys = useRef(0);
  const focusOn = useCallback((id: string) => setFocus({ id, key: ++focusKeys.current }), []);
  // Dropped once the plan has moved to it, and when the person changes floor themselves.
  const clearFocus = useCallback(() => setFocus(null), []);
  // The unit last opened stays marked in the list after its panel is closed.
  const [lastUnitId, setLastUnitId] = useState<string | null>(null);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [preview, setPreview] = useState<PickPreview | null>(null);
  const [corners, setCorners] = useState<[number, number][]>([]);
  // Each pick has a number, so a trace that comes back after the pick was
  // cancelled, restarted or left behind on another floor is thrown away.
  const pickTurn = useRef(0);
  const [cropping, setCropping] = useState<PropertyPlan | null>(null);

  // Another floor drops whatever was half done on the last one.
  useEffect(() => { pickTurn.current++; setFinding(null); setPreview(null); setCorners([]); setSelectedOutlineId(null); }, [planId]);
  useEffect(() => { setSelectedUnitId(null); setFilter("all"); setSearch(""); }, [propertyId]);
  // A unit that has gone from the feed (archived, merged) cannot stay open,
  // nor an outline that has left the plan.
  useEffect(() => { if (selectedUnitId && feed.data && !units.some(u => u.id === selectedUnitId)) setSelectedUnitId(null); }, [feed.data, selectedUnitId]);
  useEffect(() => {
    if (selectedOutlineId && board.data && !board.data.outlines.some(o => o.id === selectedOutlineId)) setSelectedOutlineId(null);
  }, [board.data, selectedOutlineId]);
  // A row that goes away under the pointer never says the pointer left it.
  useEffect(() => { setHoverUnitId(null); }, [selectedUnitId, selectedOutlineId, planId]);

  // A scan that finishes has already saved its outlines: read the units again and say what it did.
  const seenScan = useRef<string | null>(null);
  useEffect(() => {
    const scan = board.data?.scan;
    const before = seenScan.current;
    seenScan.current = scan ? `${scan.id}:${scan.status}` : null;
    if (!scan || before !== `${scan.id}:running` || scan.status === "running") return;
    void feed.refetch();
    if (scan.status === "ready" && board.data) {
      const counts = planMatchCounts(board.data);
      toast({ title: `${board.data.plan.floor} scanned`, description: `${plural(counts.linked, "outline")} linked to the tenancy schedule, ${counts.unlinked} not linked.${counts.unlinked ? " Click a grey outline to link it." : ""}` });
    }
  }, [board.data?.scan?.id, board.data?.scan?.status]);

  // Links from other screens: #tenancy-unit-<row id> (the deal page),
  // #plan-tenancy-<row id> and #plan-unit-<unit name> (the schedule's "view on
  // plan" and the brief). Each opens the unit, on the floor it is drawn on.
  const feedNow = useRef(feed.data);
  feedNow.current = feed.data;
  useEffect(() => {
    if (!feed.data) return;
    const open = () => {
      const current = feedNow.current;
      if (!current) return;
      const byRow = /^#(?:tenancy-unit|plan-tenancy)-(.+)$/.exec(window.location.hash);
      const byName = /^#plan-unit-(.+)$/.exec(window.location.hash);
      if (!byRow && !byName) return;
      let wanted = "";
      try { wanted = decodeURIComponent((byRow || byName)![1]); } catch { return; }
      const unit = byRow
        ? current.units.find(u => u.scheduleRowId === wanted)
        : current.units.find(u => u.label.trim().toLowerCase() === wanted.trim().toLowerCase());
      if (!unit) return;
      setSelectedOutlineId(null);
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
  const selectedOutline = (selectedOutlineId && board.data?.outlines.find(o => o.id === selectedOutlineId)) || null;
  const propertyName = feed.data?.property.name || null;
  const rows = usePlanRows(board.data, propertyName);
  const freeRows = useMemo(() => rows.filter(row => !row.outlinedHere), [rows]);
  // "WVL22 Bluewater - Lower Level" is "WVL22" on Bluewater's own page.
  const shortLabel = useCallback((label: string, floor?: string | null) => unitDisplayLabel(label, propertyName, floor), [propertyName]);
  const rowLabel = useCallback((rowId: string) => {
    const row = board.data?.rows.find(r => r.id === rowId);
    return row ? shortLabel(row.label, row.floor) : "this unit";
  }, [board.data, shortLabel]);
  // The grey outlines in reading order, top to bottom then left to right, for "Next not linked".
  const unlinked = useMemo(() => (board.data?.outlines || []).filter(o => !o.scheduleRowId)
    .sort((a, b) => compareReading(readingKey(a.polygon), readingKey(b.polygon))), [board.data]);

  const { shapes, stateCounts } = useMemo(() => {
    const list: CanvasShape[] = [];
    const counts: Partial<Record<UnitStateKey, number>> = {};
    for (const outline of board.data?.outlines || []) {
      const unit: PropertyUnit | undefined = outline.scheduleRowId ? unitByRow.get(outline.scheduleRowId) : undefined;
      if (!unit) {
        const reads = printedText(outline.printed) || outline.label;
        list.push({ id: `outline:${outline.id}`, polygon: outline.polygon, fill: CONTEXT_HEX, stroke: CONTEXT_HEX, dim: filtering && filter !== "notonplan", label: null,
          title: `${reads ? `${reads}: n` : "N"}ot linked to a unit. Click to link it.` });
        continue;
      }
      const state = unitStateKey(unit);
      counts[state] = (counts[state] || 0) + 1;
      list.push({
        id: `outline:${outline.id}`, polygon: outline.polygon, fill: UNIT_STATE_HEX[state], stroke: UNIT_STATE_HEX[state],
        dim: filtering && !shown.has(unit.id),
        label: shortLabel(unit.label, unit.floor),
        title: `${shortLabel(unit.label, unit.floor)}: ${unit.tenant.name ? `${unit.tenant.name}, ` : ""}${unitStateLabel(state).toLowerCase()}`,
      });
    }
    // A scan's outlines not yet saved (a scan from before saving was automatic).
    for (const proposal of board.data?.proposals || []) {
      list.push({ id: `proposal:${proposal.id}`, polygon: proposal.polygon, fill: PROPOSAL_HEX, stroke: PROPOSAL_HEX, dashed: true, label: printed(proposal.label),
        title: printed(proposal.label) ? `Found by the scan, not saved yet: the plan prints ${proposal.label}` : "Found by the scan, not saved yet" });
    }
    return { shapes: list, stateCounts: counts };
  }, [board.data, unitByRow, filtering, filter, shown, shortLabel]);

  const outlineOfUnit = (unit: PropertyUnit | null) => unit?.outlines.find(o => o.planId === planId) || null;
  const selectedShapeId = selectedOutline ? `outline:${selectedOutline.id}` : outlineOfUnit(selectedUnit) ? `outline:${outlineOfUnit(selectedUnit)!.outlineId}` : null;
  const hoverUnit = hoverUnitId ? units.find(u => u.id === hoverUnitId) || null : null;
  const hoverShapeId = outlineOfUnit(hoverUnit) ? `outline:${outlineOfUnit(hoverUnit)!.outlineId}` : null;

  const selectUnit = (unitId: string) => {
    setSelectedOutlineId(null);
    setSelectedUnitId(unitId);
    const outline = units.find(u => u.id === unitId)?.outlines.find(o => o.planId === planId);
    setLastUnitId(unitId);
    if (outline) focusOn(`outline:${outline.outlineId}`);
  };
  const openOutline = (outlineId: string) => { setSelectedUnitId(null); setSelectedOutlineId(outlineId); focusOn(`outline:${outlineId}`); };
  const selectShape = (shapeId: string) => {
    const [kind, id] = [shapeId.slice(0, shapeId.indexOf(":")), shapeId.slice(shapeId.indexOf(":") + 1)];
    // A scan outline not yet saved: the line above the plan saves them all.
    if (kind !== "outline") return;
    const outline = board.data?.outlines.find(o => o.id === id);
    const unit = outline?.scheduleRowId ? unitByRow.get(outline.scheduleRowId) : undefined;
    if (unit) { setSelectedOutlineId(null); setSelectedUnitId(unit.id); setLastUnitId(unit.id); }
    else if (outline) { setSelectedUnitId(null); setSelectedOutlineId(outline.id); }
  };
  // The next grey outline in reading order after the one open (or the first),
  // round to the top. One just linked is no longer grey: the next is the one after where it sits.
  const nextUnlinked = (from: string | null) => {
    const current = from ? board.data?.outlines.find(o => o.id === from) : undefined;
    const others = unlinked.filter(o => o.id !== from);
    if (!current) return others[0] || null;
    const key = readingKey(current.polygon);
    return others.find(o => compareReading(readingKey(o.polygon), key) > 0) || others[0] || null;
  };
  const openNextUnlinked = () => { const next = nextUnlinked(selectedOutlineId); if (next) openOutline(next.id); };

  // "Find it on the plan" for a schedule unit not drawn on this floor.
  const startFinding = (rowId: string) => {
    pickTurn.current++;
    setPreview(null); setCorners([]);
    setSelectedOutlineId(null);
    // On a phone the unit's sheet covers the plan.
    if (isMobile) setSelectedUnitId(null);
    setFinding({ rowId, step: "click", how: "click", error: null });
  };
  // "Draw a unit": the outline first, then its unit. Corner by corner, as the
  // lease advisory plans draw, with clicking inside it to find its walls a press away.
  const startDrawing = () => {
    pickTurn.current++;
    setPreview(null); setCorners([]);
    setSelectedOutlineId(null); setSelectedUnitId(null);
    setFinding({ rowId: null, step: "corners", how: "corners", error: null, saved: null });
  };
  const cancelFinding = () => { pickTurn.current++; setFinding(null); setPreview(null); setCorners([]); };
  const retryFinding = () => { pickTurn.current++; setPreview(null); setCorners([]); setFinding(f => (f ? { ...f, step: f.how, error: null } : f)); };
  const drawCorners = () => { pickTurn.current++; setPreview(null); setCorners([]); setFinding(f => (f ? { ...f, step: "corners", how: "corners", error: null } : f)); };
  const clickInside = () => { pickTurn.current++; setPreview(null); setCorners([]); setFinding(f => (f ? { ...f, step: "click", how: "click", error: null } : f)); };
  const onPick = async (point: { x: number; y: number }) => {
    if (!finding || !board.data) return;
    if (finding.step === "corners") { setCorners(list => [...list, [point.x, point.y]]); return; }
    if (finding.step !== "click" && finding.step !== "confirm") return;
    const under = (polygon: PropertyPlanPolygon) => pointInPolygon(point, points(polygon));
    const outline = board.data.outlines.find(o => under(o.polygon));
    if (outline) {
      setPreview({ kind: "outline", outlineId: outline.id, fromRowId: outline.scheduleRowId, polygon: outline.polygon });
      setFinding({ ...finding, step: "confirm", error: null });
      return;
    }
    const proposal = board.data.proposals.find(p => under(p.polygon));
    if (proposal) { setPreview({ kind: "proposal", candidateId: proposal.id, polygon: proposal.polygon }); setFinding({ ...finding, step: "confirm", error: null }); return; }
    const turn = ++pickTurn.current;
    setPreview(null);
    setFinding({ ...finding, step: "tracing", error: null });
    try {
      const traced = await actions.trace(point);
      if (pickTurn.current !== turn) return;
      setPreview({ kind: "traced", polygon: traced.polygon, imageKey: traced.imageKey });
      setFinding(f => (f ? { ...f, step: "confirm", error: null } : f));
    } catch (error) {
      if (pickTurn.current !== turn) return;
      setFinding(f => (f ? { ...f, step: "click", error: `${plainError(error)} Click another point inside it, or draw its corners.` } : f));
    }
  };
  const finishCorners = () => {
    if (!finding || corners.length < 3 || !board.data) return;
    setPreview({ kind: "traced", polygon: { points: corners }, imageKey: board.data.plan.imageKey });
    setCorners([]);
    setFinding({ ...finding, step: "confirm", error: null });
  };
  // Saves the outline on screen for its unit: the one Find it on the plan
  // started from, the one chosen after Draw a unit, or none (grey).
  const saveFinding = async (chosenRowId?: string | null) => {
    if (!finding || !preview || finding.step !== "confirm") return;
    const rowId = chosenRowId === undefined ? finding.rowId : chosenRowId;
    const label = rowId ? rowLabel(rowId) : null;
    setFinding({ ...finding, step: "saving", error: null });
    try {
      if (preview.kind === "proposal") {
        if (!board.data?.scan) throw new Error("Scan the plan again before saving this outline");
        await actions.accept({ scanId: board.data.scan.id, candidateId: preview.candidateId, scheduleRowId: rowId });
      } else if (preview.kind === "outline") {
        await actions.relink(preview.outlineId, rowId);
      } else {
        await actions.saveTraced({ polygon: preview.polygon, imageKey: preview.imageKey, scheduleRowId: rowId, label });
      }
      const done = label ? `${label} is on the plan` : "Outline saved, not linked to a unit";
      setPreview(null); setCorners([]);
      // Drawing from the plan carries on with the next unit; Done ends it.
      if (finding.rowId === null) setFinding({ ...finding, step: finding.how, error: null, saved: done });
      else { setFinding(null); toast({ title: done }); }
    } catch (error) {
      setFinding(f => (f ? { ...f, step: "confirm", error: plainError(error) } : f));
    }
  };

  // Keyboard focus goes into a panel when it opens over the list, and back
  // to that unit's row when it closes: the row it left is hidden meanwhile.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedUnitId) root.current?.querySelector<HTMLElement>('[data-testid="property-unit-panel-close"]')?.focus({ preventScroll: true });
  }, [selectedUnitId]);
  useEffect(() => {
    if (selectedOutlineId) root.current?.querySelector<HTMLElement>('[data-testid="plan-outline-close"]')?.focus({ preventScroll: true });
  }, [selectedOutlineId]);
  const closeUnit = () => {
    const closing = selectedUnitId;
    setSelectedUnitId(null);
    if (closing) requestAnimationFrame(() => {
      const rows = root.current?.querySelectorAll<HTMLElement>("[data-unit-id]") || [];
      Array.from(rows).find(row => row.dataset.unitId === closing)?.focus({ preventScroll: true });
    });
  };
  const showOnPlan = (targetPlanId: string, outlineId: string) => { setPlanId(targetPlanId); focusOn(`outline:${outlineId}`); };

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
  // Everyone can amend (Woody, 2026-11-14); the server checks the property.
  const canEdit = true;
  // Since 14 November 2026 a joint agent opens deal pages at its own schemes too.
  const dealHref = !(viewer.staff || viewer.landsecView || viewer.restricted) ? undefined : (dealId: string) => `/deals/${dealId}`;
  // After a floor is renamed or deleted: the floor pills, the stored plans and
  // (still there after a rename) the plan's own board.
  const refreshPlans = (renamed?: string) => Promise.all([
    feed.refetch(),
    queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "plans"] }),
    renamed ? queryClient.invalidateQueries({ queryKey: ["/api/plans", renamed, "match"] }) : null,
  ]);
  const opened = (id: string) => { wantedPlan.current = id; void feed.refetch(); };
  // Load a plan: a file (cropped page by page, then scanned), or for BGP
  // staff a brochure page or a SharePoint file.
  const loadButtons = canEdit && (
    <>
      <UploadPlanButton propertyId={propertyId} canScan={viewer.staff} onUploaded={plan => opened(plan.id)} className="h-7 text-xs" />
      {viewer.staff && <PlanSourcesMenu propertyId={propertyId} onImported={opened} />}
    </>
  );
  const unitPanel = (unit: PropertyUnit, variant: "side" | "page") => (
    <PropertyUnitPanel
      propertyId={propertyId} propertyName={propertyName} unit={unit} plans={plans} viewer={viewer} variant={variant}
      onClose={variant === "side" ? closeUnit : undefined}
      onShowOnPlan={plans.length ? showOnPlan : undefined}
      onFindOnPlan={canEdit && plans.length ? startFinding : undefined}
      outlineActions={canEdit ? outlineActions : undefined}
      onOpenSchedule={rowId => onOpenSchedule(rowId)}
    />
  );
  // A unit's own outline on the floor on screen: what the plan prints there,
  // and changing it to another unit, unlinking it (grey) or removing it.
  function outlineActions(outline: { planId: string; outlineId: string }) {
    const saved = board.data && outline.planId === board.data.plan.id ? board.data.outlines.find(o => o.id === outline.outlineId) : undefined;
    if (!saved) return null;
    const reads = printedText(saved.printed);
    const change = async (work: () => Promise<void>, done: string, failed: string) => {
      try { await work(); toast({ title: done }); } catch (error) { toast({ variant: "destructive", title: failed, description: plainError(error) }); }
    };
    return (
      <div className="space-y-1.5" data-testid="property-unit-outline-actions">
        {reads && <p className="text-xs text-muted-foreground">The plan prints {reads}.</p>}
        <div className="flex flex-wrap gap-1.5">
          <RowPicker label="Not this unit" rows={freeRows} disabled={actions.busy} testId="property-unit-outline-change"
            onChoose={rowId => change(() => actions.relink(saved.id, rowId), `The outline is ${rowLabel(rowId)} now`, "The outline was not moved")} />
          <Button type="button" size="sm" variant="outline" disabled={actions.busy} data-testid="property-unit-outline-unlink"
            onClick={() => change(() => actions.relink(saved.id, null), "The outline is not linked to a unit now", "The outline was not changed")}>Unlink</Button>
          <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" disabled={actions.busy} data-testid="property-unit-outline-remove"
            onClick={() => { if (window.confirm("Remove this outline from the plan? The unit stays on the tenancy schedule.")) void change(() => actions.removeOutline(saved.id), "Outline removed", "The outline was not removed"); }}>Remove from plan</Button>
        </div>
      </div>
    );
  }
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
  // News & social sits behind People in the intro row now (Woody, 2026-11-14).
  const sideSwitch = null;
  const news = <div className="min-h-0 overflow-y-auto space-y-3" data-testid="property-side-news-panel"><PropertyInstagram propertyId={propertyId} /><PropertyNewsPanel propertyId={propertyId} propertyName={propertyName || ""} /></div>;
  const list = (dense: boolean, className?: string) => (
    <PropertyUnitList
      feed={feed.data!} selectedUnitId={selectedUnitId ?? lastUnitId} onSelectUnit={selectUnit} onHoverUnit={setHoverUnitId}
      filter={filter} onFilterChange={setFilter} search={search} onSearchChange={setSearch}
      dense={dense} dealHref={dealHref} className={className}
    />
  );

  // Every shape of the tab has one header line, and the load buttons keep one
  // place in it. Loading a plan is a dialog held by UploadPlanButton (the crop
  // step, then the scan), so that button must stay mounted when the first plan
  // arrives and the tab turns from the list into the plan.
  const shell = (testId: string, lead: ReactNode, body: ReactNode, tools?: ReactNode) => (
    <div ref={root} className="space-y-3" data-testid={testId}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex min-w-0 flex-wrap items-center gap-2">{lead}</div>
        <div className="ml-auto flex flex-wrap items-center gap-2">{loadButtons}{tools}</div>
      </div>
      {body}
    </div>
  );

  // No units yet: say what the page needs, in the order it needs it.
  if (units.length === 0) {
    return shell("property-plan-setup", <h2 className="text-base font-semibold">No units recorded yet</h2>, (
      <div className="rounded-lg border border-border bg-card p-5 space-y-3 max-w-2xl">
        <p className="text-sm text-muted-foreground">The tenancy schedule is this property's list of units. Add the units there first, one line each, even if all you know is the unit's name. A plan can then be loaded and each unit is found on it.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onOpenSchedule()} data-testid="property-setup-open-schedule">Open the tenancy schedule</Button>
        </div>
        {plans.length > 0 && <p className="text-xs text-muted-foreground">{plans.length === 1 ? "A plan is" : `${plans.length} plans are`} loaded. Its outlines link to units once they are on the schedule.</p>}
        {unplaced}
      </div>
    ));
  }

  // One unit, no plan: the unit is the page.
  if (units.length === 1 && plans.length === 0) {
    return shell("property-single-unit", <p className="text-xs text-muted-foreground">This property has one unit, so everything about it is on this page.</p>, <>
      {unitPanel(units[0], "page")}
      {unplaced}
    </>);
  }

  // Several units, no plan: the list, with the unit panel opening beside it.
  if (plans.length === 0) {
    return shell("property-units-only", <p className="text-xs text-muted-foreground">No plan is loaded for this property. Load one and each unit on it is found and drawn for you.</p>, <>
      {sideSwitch}
      {side === "news" ? news : <>{list(false)}{unplaced}</>}
      <Sheet open={!!selectedUnit} onOpenChange={open => { if (!open) setSelectedUnitId(null); }}>
        <SheetContent hideClose side={isMobile ? "bottom" : "right"} className={isMobile ? "h-[88vh] p-0" : "w-full sm:max-w-xl p-0"}>
          <SheetTitle className="sr-only">Unit</SheetTitle>
          {selectedUnit && unitPanel(selectedUnit, "side")}
        </SheetContent>
      </Sheet>
    </>);
  }

  const plan = plans.find(p => p.id === planId) || plans[0];
  const stored = storedPlans.data?.plans.find(p => p.id === plan.id) || null;
  const scan = board.data?.scan || null;
  const canScan = !!board.data?.canScan;
  const floor = board.data ? planMatchCounts(board.data) : null;
  const unsaved = board.data?.proposals.length || 0;
  const waitingElsewhere = plans.filter(p => p.id !== plan.id && p.proposals > 0);
  // Find it on the plan names its unit; Draw a unit has none until the outline is there.
  const findingName = finding?.rowId ? rowLabel(finding.rowId) : "";
  const drawingFromPlan = !!finding && finding.rowId === null;
  // The units the outline drawn could be: every schedule unit not drawn on
  // this floor, those the schedule puts on this floor first; for an outline
  // already on the plan, the ones its printed number or name could be.
  const drawnOutline = preview?.kind === "outline" ? board.data?.outlines.find(o => o.id === preview.outlineId) || null : null;
  const drawnProposal = preview?.kind === "proposal" ? board.data?.proposals.find(p => p.id === preview.candidateId) || null : null;
  const thisFloorIds = freeRows.filter(row => sameFloor(row.floor, plan.floor)).map(row => row.id);
  const choosable = drawnOutline?.possibleRowIds.length
    ? { ids: drawnOutline.possibleRowIds, heading: "Possible" }
    : drawnProposal && (drawnProposal.suggestedRowId || drawnProposal.possibleRowIds.length)
      ? { ids: [drawnProposal.suggestedRowId, ...drawnProposal.possibleRowIds].filter((id): id is string => !!id), heading: "Possible" }
      : thisFloorIds.length && thisFloorIds.length < freeRows.length ? { ids: thisFloorIds, heading: `On ${plan.floor}` } : null;

  const scanPlan = async () => {
    try {
      await actions.startScan();
      toast({ title: `Scanning ${plan.floor}`, description: "Each unit it finds goes on the plan when it finishes, linked to the tenancy schedule where the plan's number or tenant names one." });
    } catch (error) { toast({ variant: "destructive", title: "The scan did not start", description: plainError(error) }); }
  };
  const saveScan = async () => {
    if (!scan) return;
    try {
      const result = await actions.acceptAll(scan.id);
      toast({ title: `${plural(result.linked, "outline")} linked to the tenancy schedule`,
        description: [result.unlinked ? `${result.unlinked} not linked: click a grey outline to link it.` : "", result.setAside ? `${result.setAside} left off where they overlapped another outline.` : ""].filter(Boolean).join(" ") || undefined });
    } catch (error) { toast({ variant: "destructive", title: "The scan's outlines were not saved", description: plainError(error) }); }
  };
  const renamePlan = async () => {
    const next = window.prompt(`Rename the ${plan.floor} plan:`, plan.floor)?.trim();
    if (!next || next === plan.floor) return;
    try { await apiRequest("PATCH", `/api/plans/${encodeURIComponent(plan.id)}`, { floor: next }); await refreshPlans(plan.id); }
    catch (error) { toast({ variant: "destructive", title: "The floor was not renamed", description: plainError(error) }); }
  };
  const deletePlan = async () => {
    if (!window.confirm(`Delete the ${plan.floor} plan and its outlines? The tenancy schedule is kept.`)) return;
    try { await apiRequest("DELETE", `/api/plans/${encodeURIComponent(plan.id)}`); toast({ title: `${plan.floor} plan deleted` }); await refreshPlans(); }
    catch (error) { toast({ variant: "destructive", title: "The plan was not deleted", description: plainError(error) }); }
  };
  const restorePlan = async () => {
    if (!stored || !window.confirm(`Bring back the whole ${plan.floor} page? The outlines move with it.`)) return;
    try { const result = await planCrop.restore(stored); toast({ title: "The whole page is back", description: result.scanning ? "Scanning it for units." : "The outlines moved with it." }); }
    catch (error) { toast({ variant: "destructive", title: "The page was not restored", description: plainError(error) }); }
  };
  const openPdf = async () => {
    try { await openOriginalPlanPdf(plan.id); } catch (error) { toast({ variant: "destructive", title: "Could not open the PDF", description: plainError(error) }); }
  };
  // The plan's own tools: scan, rename, crop, the original PDF, delete.
  // Draw a unit the scan missed, then choose its unit on the schedule.
  const drawButton = canEdit && (
    <Button type="button" variant={drawingFromPlan ? "default" : "outline"} size="sm" className="h-7 gap-1.5 text-xs" aria-pressed={drawingFromPlan}
      disabled={!board.data} onClick={() => (drawingFromPlan ? cancelFinding() : startDrawing())} data-testid="property-plan-draw-unit">
      <PenTool className="w-3.5 h-3.5" />{drawingFromPlan ? "Drawing a unit" : "Draw a unit"}
    </Button>
  );
  const planMenu = canEdit && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" data-testid="property-plan-menu"><Pencil className="w-3.5 h-3.5" />Edit plan</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canScan && (
          <DropdownMenuItem disabled={scan?.status === "running" || actions.busy} onSelect={() => void scanPlan()} data-testid="property-plan-scan">
            <ScanLine className="w-3.5 h-3.5 mr-2" />{scan ? `Scan ${plan.floor} again` : `Scan ${plan.floor} for units`}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void renamePlan()} data-testid="property-plan-rename"><Pencil className="w-3.5 h-3.5 mr-2" />Rename this floor</DropdownMenuItem>
        <DropdownMenuItem disabled={!stored} onSelect={() => stored && setCropping(stored)} data-testid="property-plan-crop"><Crop className="w-3.5 h-3.5 mr-2" />Crop this plan</DropdownMenuItem>
        {stored?.cropped && <DropdownMenuItem onSelect={() => void restorePlan()} data-testid="property-plan-crop-undo"><Undo2 className="w-3.5 h-3.5 mr-2" />Restore the whole page</DropdownMenuItem>}
        {stored?.has_pdf && <DropdownMenuItem onSelect={() => void openPdf()} data-testid="property-plan-original-pdf"><FileText className="w-3.5 h-3.5 mr-2" />Original PDF</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onSelect={() => void deletePlan()} data-testid="property-plan-delete"><Trash2 className="w-3.5 h-3.5 mr-2" />Delete the {plan.floor} plan</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const findBar = finding && (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs" data-testid="plan-find-bar">
      <p role="status" className="flex min-w-[12rem] flex-1 items-center gap-1.5">
        {(finding.step === "tracing" || finding.step === "saving") && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />}
        <span>
          {finding.saved && (finding.step === "click" || finding.step === "corners") && <span className="font-medium" data-testid="plan-draw-saved">{finding.saved}. </span>}
          {finding.step === "click" && (drawingFromPlan
            ? <>Click inside {finding.saved ? "the next" : "a"} unit on the plan: its walls are found.</>
            : <>Click inside <span className="font-medium">{findingName}</span> on the plan: the outline under the click is taken, or its walls are found.</>)}
          {finding.step === "tracing" && "Finding the walls…"}
          {finding.step === "corners" && (drawingFromPlan
            ? <>Click each corner of {finding.saved ? "the next" : "the"} unit in turn ({plural(corners.length, "corner")}), then Finish.</>
            : <>Click each corner of <span className="font-medium">{findingName}</span> in turn ({plural(corners.length, "corner")}), then Finish.</>)}
          {finding.step === "confirm" && (drawingFromPlan
            ? (preview?.kind === "outline"
              ? (preview.fromRowId
                ? <>This outline is {rowLabel(preview.fromRowId)} now. Choose another unit to move it, or click elsewhere to pick again.</>
                : <>This outline is on the plan, not linked to a unit. Choose its unit, or click elsewhere to pick again.</>)
              : <>Which unit on the tenancy schedule is the highlighted outline? Choose it, or save it grey to link later.</>)
            : preview?.kind === "outline" && preview.fromRowId
              ? <>This outline is {rowLabel(preview.fromRowId)} now. Save moves it to <span className="font-medium">{findingName}</span>.</>
              : <>Is the highlighted outline <span className="font-medium">{findingName}</span>? Click elsewhere to pick again.</>)}
          {finding.step === "saving" && "Saving…"}
        </span>
      </p>
      {finding.step === "confirm" && !drawingFromPlan && <Button type="button" size="sm" className="h-7 text-xs" disabled={actions.busy} onClick={() => void saveFinding()} data-testid="plan-find-save">Save outline</Button>}
      {finding.step === "confirm" && drawingFromPlan && (
        <RowPicker label="Choose the unit" rows={freeRows} possibleIds={choosable?.ids} possibleHeading={choosable?.heading} primary
          disabled={actions.busy} onChoose={rowId => void saveFinding(rowId)} testId="plan-draw-choose" />
      )}
      {finding.step === "confirm" && drawingFromPlan && preview?.kind !== "outline" && (
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={actions.busy} onClick={() => void saveFinding(null)} data-testid="plan-draw-save-grey">Save it grey</Button>
      )}
      {finding.step === "confirm" && <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={retryFinding} data-testid="plan-find-retry">{drawingFromPlan ? "Draw again" : "Try again"}</Button>}
      {finding.step === "click" && <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={drawCorners} data-testid="plan-find-corners">Draw its corners instead</Button>}
      {finding.step === "corners" && <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={!corners.length} onClick={() => setCorners(list => list.slice(0, -1))} data-testid="plan-find-undo-corner">Undo corner</Button>}
      {finding.step === "corners" && <Button type="button" size="sm" className="h-7 text-xs" disabled={corners.length < 3} onClick={finishCorners} data-testid="plan-find-finish">Finish</Button>}
      {finding.step === "corners" && <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={clickInside} data-testid="plan-find-click-inside">Click inside it instead</Button>}
      {finding.step !== "saving" && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelFinding} data-testid="plan-find-cancel">{finding.saved ? "Done" : "Cancel"}</Button>}
      {finding.step === "confirm" && drawingFromPlan && preview?.kind !== "outline" && (
        <p className="basis-full text-muted-foreground">Not on the tenancy schedule yet? Save it grey, add the unit on the Tenancy schedule tab, then click the grey outline to link it.</p>
      )}
      {finding.error && <p className="basis-full text-destructive" role="alert">{finding.error}</p>}
    </div>
  );
  const outlinePanel = (className: string) => selectedOutline && (
    <OutlinePanel
      outline={selectedOutline} floor={plan.floor} rows={rows} actions={actions}
      unlinkedCount={unlinked.length}
      onNext={nextUnlinked(selectedOutline.id) ? openNextUnlinked : null}
      onOpenUnit={rowId => { const unit = unitByRow.get(rowId); if (unit) selectUnit(unit.id); }}
      onClose={() => setSelectedOutlineId(null)}
      className={className}
    />
  );

  return shell("property-plan-workspace", <>
    <div className="flex flex-wrap gap-1.5" data-testid="property-plan-floors">
      {plans.map(p => (
        <Pill key={p.id} active={p.id === plan.id} onClick={() => { clearFocus(); setPlanId(p.id); }} data-testid={`property-plan-floor-${p.id}`}>
          {p.floor} <PillCount n={p.outlines - p.unlinkedOutlines} active={p.id === plan.id} />
        </Pill>
      ))}
    </div>
    <p className="text-[11px] text-muted-foreground">
      <Num n={counts.onPlan} /> of <Num n={counts.units} /> units drawn on {plans.length === 1 ? "the plan" : "the plans"}
      {unlinked.length > 0 && <> · <button type="button" className="hover:underline" onClick={() => { const next = nextUnlinked(null); if (next) openOutline(next.id); }} data-testid="property-plan-unlinked"><Num n={unlinked.length} /> not linked on {plan.floor}</button></>}
    </p>
  </>, <>
    {scan?.status === "running" && (
      <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="property-plan-scanning">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        <span>Reading the {plan.floor} plan for units{scan.total > 0 && <> · <Num n={scan.completed} /> of <Num n={scan.total} /></>}. Each unit it finds goes on the plan, linked to the tenancy schedule, when it finishes.</span>
      </p>
    )}
    {scan?.status === "failed" && (
      <p className="text-xs text-muted-foreground" role="alert" data-testid="property-plan-scan-failed">
        The last scan of {plan.floor} could not finish. {scan.message}{" "}
        {canScan ? <><button type="button" className="text-primary hover:underline" disabled={actions.busy} onClick={() => void scanPlan()}>Scan again</button>, or draw</> : "Draw"} the units it missed with{" "}
        <button type="button" className="text-primary hover:underline" onClick={startDrawing} data-testid="property-plan-scan-failed-draw">Draw a unit</button>.
      </p>
    )}
    {unsaved > 0 && scan?.status === "ready" && (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs" data-testid="property-plan-unsaved">
        <span className="min-w-[12rem] flex-1">
          The scan found <Num n={unsaved} /> {unsaved === 1 ? "outline" : "outlines"} on {plan.floor} that {unsaved === 1 ? "is" : "are"} not on the plan yet (dashed). Saving links each to the unit its number or tenant names; the rest are saved grey, to link or remove.
          {waitingElsewhere.length > 0 && <> Also waiting: {waitingElsewhere.map((p, i) => <span key={p.id}>{i > 0 && ", "}<button type="button" className="text-primary hover:underline" onClick={() => { clearFocus(); setPlanId(p.id); }}>{p.floor} ({p.proposals})</button></span>)}.</>}
        </span>
        <Button type="button" size="sm" className="h-7 text-xs" disabled={actions.busy} onClick={() => void saveScan()} data-testid="property-plan-save-scan">Save them</Button>
      </div>
    )}
    {findBar}

    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px] gap-3 items-start">
      <div className="min-w-0 space-y-2">
        {board.isError ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm">
            <p>This plan could not be loaded. {plainError(board.error)}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => board.refetch()}>Try again</Button>
          </div>
        ) : (
          <PlanCanvas
            key={plan.id}
            planId={plan.id} imageKey={board.data?.plan.imageKey ?? null} floor={plan.floor} width={board.data?.plan.width ?? null} height={board.data?.plan.height ?? null}
            shapes={shapes} selectedId={selectedShapeId} hoverId={hoverShapeId}
            onSelect={selectShape} focusId={focus?.id || null} focusKey={focus?.key || 0} onFocused={clearFocus}
            pick={finding && finding.step !== "saving" ? { hint: finding.step === "corners" ? `Click the corners of ${findingName || "the unit"}` : `Click inside ${findingName || "the unit"}`, busy: finding.step === "tracing", onPick } : null}
            preview={preview?.polygon || null}
            corners={finding?.step === "corners" ? corners : null}
            className="h-[46vh] lg:h-[calc(100vh-400px)] min-h-[320px] lg:min-h-[440px]"
          />
        )}
        <UnitStateLegend counts={stateCounts}>
          {unlinked.length > 0 && (
            <button type="button" className="inline-flex items-center gap-1.5 hover:underline" onClick={() => { const next = nextUnlinked(selectedOutlineId); if (next) openOutline(next.id); }} data-testid="property-plan-legend-unlinked">
              <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: CONTEXT_HEX }} />Not linked to a unit <Num n={unlinked.length} />
            </button>
          )}
          {unsaved > 0 && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: PROPOSAL_HEX }} />Found by the scan, not saved <Num n={unsaved} /></span>}
          {floor && floor.linked === 0 && unlinked.length === 0 && unsaved === 0 && scan?.status !== "running" && (
            <span>Nothing is drawn on {plan.floor} yet.{canScan ? " Scan it from Edit plan, or use Draw a unit." : " Use Draw a unit to outline each unit."}</span>
          )}
        </UnitStateLegend>
      </div>

      <div className="relative min-w-0 lg:h-[calc(100vh-400px)] lg:min-h-[440px]">
        {/* The list stays laid out under an open panel, so it is already at that unit when the panel closes. */}
        <div className={`h-full flex flex-col gap-2 ${(selectedUnit || selectedOutline) && !isMobile ? "invisible max-lg:hidden" : ""}`}>
          {sideSwitch}
          {side === "news" ? news : <>{list(true, "lg:flex-1 lg:min-h-0 max-h-[640px] lg:max-h-none")}{unplaced}</>}
        </div>
        {selectedUnit && !isMobile && <div className="rounded-lg border border-border bg-card overflow-hidden lg:absolute lg:inset-0">{unitPanel(selectedUnit, "side")}</div>}
        {selectedOutline && !isMobile && <div className="rounded-lg border border-border bg-card overflow-y-auto lg:absolute lg:inset-0">{outlinePanel("")}</div>}
      </div>
    </div>

    {isMobile && (
      <Sheet open={!!selectedUnit} onOpenChange={open => { if (!open) setSelectedUnitId(null); }}>
        <SheetContent hideClose side="bottom" className="h-[88vh] p-0">
          <SheetTitle className="sr-only">Unit</SheetTitle>
          {selectedUnit && unitPanel(selectedUnit, "side")}
        </SheetContent>
      </Sheet>
    )}
    {isMobile && (
      <Sheet open={!!selectedOutline} onOpenChange={open => { if (!open) setSelectedOutlineId(null); }}>
        <SheetContent hideClose side="bottom" className="max-h-[80vh] overflow-y-auto p-0">
          <SheetTitle className="sr-only">Outline</SheetTitle>
          {outlinePanel("pb-6")}
        </SheetContent>
      </Sheet>
    )}
    {cropping && (
      <PlanCropDialog key={cropping.id} plan={cropping} onClose={() => setCropping(null)} onCropped={result => toast({
        title: `${result.plan.floor} plan cropped`,
        description: [result.removed ? `${plural(result.removed, "loose outline")} outside the crop removed.` : null, result.scanning ? "Scanning the cropped plan for units." : null, "Edit plan, Restore the whole page puts it back."].filter(Boolean).join(" "),
      })} />
    )}
  </>, <>{drawButton}{planMenu}</>);
}
