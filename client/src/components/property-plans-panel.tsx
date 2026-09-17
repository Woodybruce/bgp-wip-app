// Property plans share boundary tracing with lease advisory. Saved outlines link
// to tenancy row IDs, so renames and lease edits keep the plan in step.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { formatCalendarDate } from "@shared/calendar-date";
import { Map as MapIcon, Upload, Trash2, Pencil, FileText, Layers, ChevronRight, ScanLine, Hand, Undo2, Link2 } from "lucide-react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PropertyPlanScanReview } from "./property-plan-scan-review";
import { PropertyPlanPreview, usePropertyPlanImage } from "./property-plan-preview";
import { planUnitChoiceKey, type PropertyPlan as Plan, type PropertyPlanUnit as PlanUnit, type PickablePlanUnit as PickableUnit, type PlanPolygon } from "./property-plan-types";

const STATUS_COLOURS: Record<string, { stroke: string; label: string }> = {
  occupied: { stroke: "#10b981", label: "Occupied" },
  lease_event: { stroke: "#eab308", label: "Lease event <18m" },
  under_offer: { stroke: "#f97316", label: "Under offer" },
  deal_in_progress: { stroke: "#3b82f6", label: "Deal in progress" },
  vacant: { stroke: "#f43f5e", label: "Vacant" },
  unlinked: { stroke: "#94a3b8", label: "Unlinked" },
  unknown: { stroke: "#94a3b8", label: "Unknown" },
};
function formatMoney(n: number | null | undefined): string { return n == null ? "—" : `£${Math.round(n).toLocaleString()}`; }
function formatDate(s: string | null | undefined): string {
  return formatCalendarDate(s) ?? "—";
}
type EditorMode = "select" | "trace" | "draw";

export function PropertyPlansPanel({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const canEdit = Boolean(currentUser);
  const canScan = canEdit && currentUser.role !== "Client" && !currentUser.companyScopeId;
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("select");
  const [pendingPoints, setPendingPoints] = useState<[number, number][]>([]);
  const [linkDialog, setLinkDialog] = useState<{ polygon: PlanPolygon; imageKey?: string; existingUnit?: PlanUnit } | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [highlightedLabel, setHighlightedLabel] = useState<string | null>(null);
  const [highlightedTenancyId, setHighlightedTenancyId] = useState<string | null>(null);
  const [highlightRequest, setHighlightRequest] = useState(0);
  const resolvedHighlight = useRef<string | null>(null);
  useEffect(() => {
    const read = () => {
      resolvedHighlight.current = null;
      setHighlightRequest(value => value + 1);
      void queryClient.invalidateQueries({ queryKey: ["/api/plans", "property-links", propertyId] });
      const match = window.location.hash.match(/^#plan-unit-(.+)$/);
      const tenancyMatch = window.location.hash.match(/^#plan-tenancy-(.+)$/);
      try {
        setHighlightedLabel(match ? decodeURIComponent(match[1]) : null);
        setHighlightedTenancyId(tenancyMatch ? decodeURIComponent(tenancyMatch[1]) : null);
      } catch { setHighlightedLabel(null); setHighlightedTenancyId(null); }
    };
    read(); window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [propertyId, queryClient]);
  const plansQ = useQuery<{ plans: Plan[] }>({
    queryKey: ["/api/properties", propertyId, "plans"],
    queryFn: async () => (await apiRequest("GET", `/api/properties/${propertyId}/plans`)).json(),
  });
  const plans = plansQ.data?.plans || [];
  const activePlan = useMemo(() => plans.find(plan => plan.id === activePlanId) || plans[0] || null, [plans, activePlanId]);
  const activePlanRef = useRef<string | undefined>(activePlan?.id);
  activePlanRef.current = activePlan?.id;
  const unitsQ = useQuery<{ units: PlanUnit[] }>({
    queryKey: ["/api/plans", activePlan?.id, "units"],
    queryFn: async () => (await apiRequest("GET", `/api/plans/${activePlan!.id}/units`)).json(),
    enabled: Boolean(activePlan),
  });
  const highlightPlansQ = useQuery<Array<{ planId: string; units: PlanUnit[] }>>({
    queryKey: ["/api/plans", "property-links", propertyId, plans.map(plan => plan.id)],
    queryFn: () => Promise.all(plans.map(async plan => ({ planId: plan.id, units: (await (await apiRequest("GET", `/api/plans/${plan.id}/units`)).json()).units as PlanUnit[] }))),
    enabled: Boolean((highlightedLabel || highlightedTenancyId) && plans.length > 1),
  });
  useEffect(() => {
    const target = highlightedTenancyId ? `tenancy:${highlightedTenancyId}` : highlightedLabel ? `label:${highlightedLabel}` : null;
    if (!target) { resolvedHighlight.current = null; return; }
    if (resolvedHighlight.current === target || !highlightPlansQ.data || highlightPlansQ.isFetching || highlightPlansQ.isError) return;
    const matches = highlightPlansQ.data.filter(plan => plan.units.some(unit => highlightedTenancyId
      ? unit.tenancy_unit_id === highlightedTenancyId
      : [unit.label, unit.unit_name].some(value => value?.trim().toLowerCase() === highlightedLabel?.trim().toLowerCase())));
    // Old name-based links may be ambiguous across floors. Never guess between them.
    if (matches.length === 1) { setActivePlanId(matches[0].planId); resolvedHighlight.current = target; }
  }, [highlightPlansQ.data, highlightPlansQ.isFetching, highlightPlansQ.isError, highlightedLabel, highlightedTenancyId, highlightRequest]);
  const units = unitsQ.data?.units || [];
  const selectedUnit = units.find(unit => unit.id === selectedUnitId);
  useEffect(() => {
    setMode("select"); setPendingPoints([]); setLinkDialog(null); setSelectedUnitId(null);
  }, [activePlan?.id, propertyId]);
  const trace = useMutation({
    mutationFn: async ({ planId, x, y }: { planId: string; x: number; y: number }) => {
      const result = await (await apiRequest("POST", `/api/plans/${planId}/trace-unit`, { x, y })).json();
      return { ...result, planId } as { polygon: PlanPolygon; imageKey: string; planId: string };
    },
    onSuccess: result => {
      if (result.planId !== activePlanRef.current) return;
      setLinkDialog({ polygon: result.polygon, imageKey: result.imageKey }); setMode("select");
    },
    onError: error => toast({ title: "Could not trace this unit", description: `${error.message} Try another clear point inside the unit, or use Draw unit.`, variant: "destructive" }),
  });
  const refreshUnits = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/plans", "property-links", propertyId] });
    return queryClient.invalidateQueries({ queryKey: ["/api/plans", activePlan?.id, "units"] });
  };
  function changeMode(next: EditorMode) { setMode(previous => previous === next ? "select" : next); setPendingPoints([]); }
  return <Card data-testid="property-plans-panel">
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 p-4 pb-2 space-y-0">
      <CardTitle className="text-sm flex items-center gap-2"><MapIcon className="w-4 h-4" /> Plans <Badge variant="secondary" className="text-xs">{plans.length}</Badge></CardTitle>
      <div className="flex flex-wrap items-center gap-1.5">
        {canEdit && <UploadPlanButton propertyId={propertyId} onUploaded={plan => setActivePlanId(plan.id)} />}
        {activePlan && canEdit && <>
          <PropertyPlanScanReview key={activePlan.id} plan={activePlan} canStart={canScan} />
          <Button size="sm" variant={mode === "trace" ? "default" : "outline"} className="h-8 text-xs" onClick={() => changeMode("trace")} disabled={trace.isPending} data-testid="button-trace-property-unit"><ScanLine className="w-3.5 h-3.5 mr-1" />{trace.isPending ? "Tracing…" : mode === "trace" ? "Cancel trace" : "Trace unit"}</Button>
          <Button size="sm" variant={mode === "draw" ? "default" : "outline"} className="h-8 text-xs" onClick={() => changeMode("draw")} disabled={trace.isPending} data-testid="button-toggle-draw-mode"><Pencil className="w-3.5 h-3.5 mr-1" />{mode === "draw" ? "Cancel drawing" : "Draw unit"}</Button>
          <DeletePlanButton plan={activePlan} onDeleted={() => setActivePlanId(null)} />
        </>}
      </div>
    </CardHeader>
    <CardContent className="p-4 pt-0 space-y-3">
      {plansQ.isError && <p role="alert" className="text-sm text-destructive">{plansQ.error.message} <button className="underline" onClick={() => plansQ.refetch()}>Retry</button></p>}
      {plansQ.isPending ? <p className="text-sm text-muted-foreground">Loading plans…</p> : !plansQ.isError && plans.length === 0 ? <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Upload a plan image or PDF to trace units and link them to the tenancy schedule.</div> : activePlan && <>
        <div className="flex items-center gap-1 flex-wrap">
          {plans.map(plan => <button key={plan.id} onClick={() => setActivePlanId(plan.id)} onDoubleClick={async () => {
            if (!canEdit) return;
            const next = prompt(`Rename floor "${plan.floor}":`, plan.floor)?.trim();
            if (!next || next === plan.floor) return;
            try { await apiRequest("PATCH", `/api/plans/${plan.id}`, { floor: next }); queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "plans"] }); }
            catch (error: any) { toast({ title: "Could not rename floor", description: error.message, variant: "destructive" }); }
          }} className={`text-xs px-2 py-1 rounded border ${plan.id === activePlan.id ? "bg-foreground text-background border-foreground" : "bg-card hover:bg-muted"}`} data-testid={`button-floor-${plan.floor}`} title={canEdit ? "Click to switch · double-click to rename" : "Click to switch"}><Layers className="w-3 h-3 inline mr-1" />{plan.floor}</button>)}
        </div>
        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">{["occupied", "lease_event", "under_offer", "deal_in_progress", "vacant", "unlinked"].map(status => <span key={status} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm border-2" style={{ borderColor: STATUS_COLOURS[status].stroke }} />{STATUS_COLOURS[status].label}</span>)}</div>
        {highlightPlansQ.isError && <p role="alert" className="text-xs text-destructive">Could not find this unit across all floors. <button className="underline" onClick={() => highlightPlansQ.refetch()}>Retry</button></p>}
        {unitsQ.isError && <p role="alert" className="text-sm text-destructive">Unit outlines could not be loaded. <button className="underline" onClick={() => unitsQ.refetch()}>Retry</button></p>}
        <PlanCanvas key={activePlan.id} plan={activePlan} units={units} mode={mode} busy={trace.isPending} pendingPoints={pendingPoints} setPendingPoints={setPendingPoints} onTrace={([x, y]) => { if (!trace.isPending) trace.mutate({ planId: activePlan.id, x, y }); }} onFinishPolygon={points => { setLinkDialog({ polygon: { points } }); setPendingPoints([]); setMode("select"); }} onSelectUnit={unit => setSelectedUnitId(unit.id)} highlightedLabel={highlightedLabel} highlightedTenancyId={highlightedTenancyId} multipleFloors={plans.length > 1} />
        {mode === "draw" && <div className="flex items-center flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!pendingPoints.length} onClick={() => setPendingPoints(points => points.slice(0, -1))}><Undo2 className="w-3.5 h-3.5 mr-1" />Undo point</Button><Button size="sm" disabled={pendingPoints.length < 3} onClick={() => { setLinkDialog({ polygon: { points: pendingPoints } }); setPendingPoints([]); setMode("select"); }}>Review boundary</Button><span className="text-xs text-muted-foreground">{pendingPoints.length} points · click corners in order, then review.</span></div>}
        <p className="text-xs text-muted-foreground">Select an outline to view its tenancy details or change its link. Trace unit follows a closed boundary around the point you click; use Draw unit where lines are open or unclear.</p>
      </>}
      {linkDialog && activePlan && <LinkPolygonDialog propertyId={propertyId} plan={activePlan} polygon={linkDialog.polygon} imageKey={linkDialog.imageKey} existingUnit={linkDialog.existingUnit} onClose={() => setLinkDialog(null)} onSaved={() => { setLinkDialog(null); refreshUnits(); }} />}
      {selectedUnit && activePlan && !linkDialog && <UnitDetailDrawer key={selectedUnit.id} unit={selectedUnit} propertyId={propertyId} onClose={() => setSelectedUnitId(null)} onUpdated={refreshUnits} onRelink={() => setLinkDialog({ polygon: selectedUnit.polygon, existingUnit: selectedUnit })} readOnly={!canEdit} />}
    </CardContent>
  </Card>;
}

function PlanCanvas({ plan, units, mode, busy, pendingPoints, setPendingPoints, onFinishPolygon, onTrace, onSelectUnit, highlightedLabel, highlightedTenancyId, multipleFloors }: {
  plan: Plan; units: PlanUnit[]; mode: EditorMode; busy: boolean; pendingPoints: [number, number][];
  setPendingPoints: (points: [number, number][]) => void; onFinishPolygon: (points: [number, number][]) => void;
  onTrace: (point: [number, number]) => void; onSelectUnit: (unit: PlanUnit) => void;
  highlightedLabel: string | null; highlightedTenancyId: string | null; multipleFloors: boolean;
}) {
  const image = usePropertyPlanImage(plan.id);
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState({ w: plan.width || 1600, h: plan.height || 1000 });
  const [hoverUnit, setHoverUnit] = useState<PlanUnit | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const dragRef = useRef<{ x: number; y: number; offset: { x: number; y: number }; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const isPanning = panMode || mode === "select";
  const highlighted = useMemo(() => {
    if (highlightedTenancyId) return units.find(unit => unit.tenancy_unit_id === highlightedTenancyId)?.id;
    const key = highlightedLabel?.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key) return null;
    return units.find(unit => [unit.label, unit.unit_name, unit.tenancy_unit_id, unit.unit_id].some(value => value?.toLowerCase().replace(/[^a-z0-9]/g, "") === key))?.id;
  }, [units, highlightedLabel, highlightedTenancyId]);
  useEffect(() => { setPanMode(false); suppressClick.current = false; dragRef.current = null; }, [mode]);
  function click(event: React.MouseEvent<HTMLDivElement>) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (busy || isPanning || !image.src) return;
    const rect = innerRef.current!.getBoundingClientRect();
    const point: [number, number] = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
    if (point.some(value => value < 0 || value > 1)) return;
    if (mode === "trace") { onTrace(point); return; }
    if (pendingPoints.length >= 3 && Math.hypot((point[0] - pendingPoints[0][0]) * rect.width, (point[1] - pendingPoints[0][1]) * rect.height) < 10) { onFinishPolygon(pendingPoints); return; }
    // A double click must not add a second, nearly identical point.
    if (event.detail > 1) return;
    setPendingPoints([...pendingPoints, point]);
  }
  return <div ref={containerRef} className="relative w-full overflow-hidden rounded border bg-muted/20 touch-pan-y" style={{ aspectRatio: `${naturalSize.w} / ${naturalSize.h}` }} data-testid="plan-canvas">
    <div ref={innerRef} className="absolute inset-0" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: "center center", cursor: busy ? "wait" : isPanning ? scale > 1 || panMode ? "grab" : "default" : "crosshair", touchAction: isPanning && scale > 1 || !isPanning ? "none" : "pan-y" }}
      onClick={click} onPointerDown={event => {
        suppressClick.current = false;
        if (!isPanning || busy || event.button !== 0 || (scale === 1 && !panMode)) return;
        dragRef.current = { x: event.clientX, y: event.clientY, offset, moved: false };
      }} onPointerMove={event => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true; suppressClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        const outer = containerRef.current?.getBoundingClientRect();
        const maxX = (outer?.width || 0) * Math.max(0, scale - 1) / 2;
        const maxY = (outer?.height || 0) * Math.max(0, scale - 1) / 2;
        setOffset({ x: Math.max(-maxX, Math.min(maxX, drag.offset.x + dx)), y: Math.max(-maxY, Math.min(maxY, drag.offset.y + dy)) });
        setHoverUnit(null);
      }} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; suppressClick.current = true; }} onPointerLeave={() => { if (!suppressClick.current) dragRef.current = null; }}>
      {image.src && <img src={image.src} alt={`${plan.floor} plan`} className="block w-full h-full pointer-events-none select-none" draggable={false} onLoad={event => setNaturalSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })} />}
      <svg viewBox={`0 0 ${naturalSize.w} ${naturalSize.h}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        {units.map(unit => {
          const colour = STATUS_COLOURS[unit.status] || STATUS_COLOURS.unknown;
          const hover = hoverUnit?.id === unit.id;
          return <polygon key={unit.id} points={unit.polygon.points.map(([x, y]) => `${x * naturalSize.w},${y * naturalSize.h}`).join(" ")} fill={colour.stroke} fillOpacity={hover ? 0.15 : 0} stroke={unit.id === highlighted ? "#6366f1" : colour.stroke} strokeWidth={unit.id === highlighted || hover ? 3 : 1.5} vectorEffect="non-scaling-stroke" className={unit.id === highlighted ? "animate-pulse" : ""} style={{ pointerEvents: mode === "select" && !panMode ? "auto" : "none", cursor: "pointer" }} role="button" tabIndex={mode === "select" && !panMode ? 0 : -1} aria-label={`View ${unit.unit_name || unit.label || "unit"}`} onClick={event => { if (suppressClick.current) return; event.stopPropagation(); onSelectUnit(unit); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectUnit(unit); } }} onMouseEnter={event => {
            setHoverUnit(unit); const rect = containerRef.current?.getBoundingClientRect();
            if (rect) setTooltipPos({ x: Math.max(4, Math.min(rect.width - 250, event.clientX - rect.left + 8)), y: Math.max(4, Math.min(rect.height - 80, event.clientY - rect.top + 8)) });
          }} onMouseLeave={() => { setHoverUnit(null); setTooltipPos(null); }} />;
        })}
        {mode === "draw" && pendingPoints.length > 0 && <>
          <polyline points={pendingPoints.map(([x, y]) => `${x * naturalSize.w},${y * naturalSize.h}`).join(" ")} fill="none" stroke="#6366f1" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {pendingPoints.map(([x, y], index) => <circle key={index} cx={x * naturalSize.w} cy={y * naturalSize.h} r={5 / scale * naturalSize.w / (containerRef.current?.clientWidth || 800)} fill={index === 0 ? "#4f46e5" : "#6366f1"} />)}
        </>}
      </svg>
    </div>
    {image.isError && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center text-sm text-destructive bg-background/95"><p>{image.error.message}</p><button className="underline" onClick={() => image.refetch()}>Retry image</button></div>}
    {image.isPending && <div role="status" className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Loading plan image…</div>}
    {hoverUnit && tooltipPos && <div className="absolute pointer-events-none bg-popover border rounded shadow-md px-2 py-1.5 text-xs z-10 max-w-[240px]" style={{ left: tooltipPos.x, top: tooltipPos.y }}><div className="font-semibold">{hoverUnit.unit_name || hoverUnit.label || "Unit"}{hoverUnit.tenant_name && <span className="font-normal text-muted-foreground"> · {hoverUnit.tenant_name}</span>}</div><div className="text-muted-foreground">{STATUS_COLOURS[hoverUnit.status]?.label || hoverUnit.status}{hoverUnit.rent_pa != null ? ` · ${formatMoney(hoverUnit.rent_pa)}/yr` : ""}</div></div>}
    {mode !== "select" && <div role="status" className="absolute top-2 left-2 right-2 pointer-events-none bg-card/95 border rounded px-2 py-1 text-xs shadow-sm">{busy ? "Tracing the boundary…" : panMode ? "Pan the plan, then turn Pan off to continue." : mode === "trace" ? "Click a clear point inside one unit to trace its boundary." : "Click each corner. Click the first point again, or use Review boundary to finish."}</div>}
    {mode === "select" && (highlightedLabel || highlightedTenancyId) && !highlighted && <div className="absolute top-2 left-2 right-2 bg-amber-50 border border-amber-300 rounded px-2 py-1 text-xs text-amber-900">No linked outline for this unit on this floor.{multipleFloors ? " Check another floor or add an outline." : " Trace or draw its boundary, then link it to the tenancy row."}</div>}
    <div className="absolute bottom-2 right-2 flex items-center flex-wrap gap-1 z-10 bg-card/90 p-1 rounded border">
      <button className={`h-7 px-2 rounded text-xs ${panMode ? "bg-foreground text-background" : "hover:bg-muted"}`} aria-label="Pan plan" aria-pressed={panMode} onClick={() => setPanMode(value => !value)}><Hand className="w-3.5 h-3.5" /></button>
      <button className="h-7 w-7 rounded hover:bg-muted text-base" aria-label="Zoom out plan" disabled={scale === 1} onClick={() => { setScale(value => Math.max(1, value / 1.25)); setOffset({ x: 0, y: 0 }); }}>−</button>
      <button className="h-7 px-1 rounded hover:bg-muted text-xs" aria-label="Reset plan zoom" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>{Math.round(scale * 100)}%</button>
      <button className="h-7 w-7 rounded hover:bg-muted text-base" aria-label="Zoom in plan" disabled={scale >= 8} onClick={() => setScale(value => Math.min(8, value * 1.25))}>+</button>
    </div>
  </div>;
}

function UploadPlanButton({ propertyId, onUploaded }: { propertyId: string; onUploaded: (plan: Plan) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [floor, setFloor] = useState("Ground");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [completedPages, setCompletedPages] = useState(0);
  async function uploadImage(image: File, floorLabel: string): Promise<Plan> {
    if (image.size > 25 * 1024 * 1024) throw new Error("This page is over the 25MB upload limit. Export this page as a smaller lossless PNG and upload it separately.");
    const form = new FormData();
    form.append("file", image); form.append("floor", floorLabel); form.append("source", "leasing-plan");
    const response = await fetch(`/api/properties/${propertyId}/plans`, { method: "POST", body: form, credentials: "include", headers: getAuthHeaders() });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Upload failed (${response.status})`);
    return response.json();
  }
  async function submit() {
    if (!file) return;
    setError(null); setUploading(true);
    let uploaded = completedPages;
    let pdfDocument: import("pdfjs-dist").PDFDocumentProxy | undefined;
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("Choose a file no larger than 25MB.");
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        pdfDocument = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
        for (let pageNumber = completedPages + 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
          setProgress(`Preparing page ${pageNumber} of ${pdfDocument.numPages}…`);
          const page = await pdfDocument.getPage(pageNumber);
          const base = page.getViewport({ scale: 1 });
          // Render at high resolution without an unbounded canvas on large CAD sheets.
          const scale = Math.min(3, 6500 / Math.max(base.width, base.height), Math.sqrt(24_000_000 / (base.width * base.height)));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          try {
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Your browser could not prepare this PDF page. Try uploading a PNG export.");
            await page.render({ canvas, canvasContext: context, viewport, background: "white" }).promise;
            const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("This PDF page could not be converted to an image.")), "image/png"));
            setProgress(`Uploading page ${pageNumber} of ${pdfDocument.numPages}…`);
            const plan = await uploadImage(new File([blob], file.name.replace(/\.pdf$/i, "") + `-p${pageNumber}.png`, { type: "image/png" }), pageNumber === 1 ? floor : `${floor} · page ${pageNumber}`);
            uploaded = pageNumber; setCompletedPages(pageNumber); onUploaded(plan);
          } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
        }
        toast({ title: `Uploaded ${pdfDocument.numPages} page${pdfDocument.numPages === 1 ? "" : "s"}`, description: "Each page has its own plan. Double-click its floor name to rename it." });
      } else {
        setProgress("Uploading original image…");
        onUploaded(await uploadImage(file, floor));
        toast({ title: "Plan uploaded", description: "The original image resolution has been kept." });
      }
      setOpen(false); setFile(null); setCompletedPages(0); setProgress("");
    } catch (cause: any) {
      const message = `${cause?.message || "Upload failed."}${uploaded ? ` ${uploaded} page${uploaded === 1 ? " has" : "s have"} already been saved. Retry resumes at the next page.` : ""}`;
      setError(message);
      toast({ title: "Upload could not finish", description: message, variant: "destructive" });
    } finally {
      await pdfDocument?.destroy().catch(() => undefined);
      setUploading(false);
      queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "plans"] });
    }
  }
  return <>
    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setOpen(true)} data-testid="button-upload-plan"><Upload className="w-3.5 h-3.5 mr-1" />Upload plan</Button>
    <Dialog open={open} onOpenChange={value => { if (!uploading) setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>Upload property plan</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <label className="block text-sm">Floor / plan name<input value={floor} disabled={uploading || completedPages > 0} onChange={event => setFloor(event.target.value)} className="mt-1 w-full text-sm border rounded px-2 py-2 bg-background" /></label>
        <label className="block text-sm">PDF, PNG, JPG or WebP · up to 25MB<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => { setFile(event.target.files?.[0] || null); setCompletedPages(0); setError(null); setProgress(""); }} className="mt-2 block w-full text-sm" /></label>
        <p className="text-xs text-muted-foreground">Images keep their original resolution. PDFs are rendered as high-resolution images, with one plan per page. Rename each page to its floor after upload.</p>
        {progress && <p role="status" className="text-sm">{progress}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div><DialogFooter><Button variant="outline" disabled={uploading} onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} disabled={uploading || !file || !floor.trim()}>{uploading ? "Uploading…" : completedPages ? "Resume upload" : "Upload"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}

function DeletePlanButton({ plan, onDeleted }: { plan: Plan; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/plans/${plan.id}`),
    onSuccess: () => { onDeleted(); queryClient.invalidateQueries({ queryKey: ["/api/properties", plan.property_id, "plans"] }); toast({ title: "Plan deleted" }); },
    onError: error => toast({ title: "Delete failed", description: error.message, variant: "destructive" }),
  });
  return <Button size="sm" variant="outline" className="h-8 px-2" disabled={remove.isPending} aria-label={`Delete ${plan.floor} plan`} title={`Delete ${plan.floor} plan`} onClick={() => { if (confirm(`Delete the ${plan.floor} plan and its outlines? The linked tenancy records will be kept.`)) remove.mutate(); }}><Trash2 className="w-3.5 h-3.5" /></Button>;
}

function LinkPolygonDialog({ propertyId, plan, polygon, imageKey, existingUnit, onClose, onSaved }: {
  propertyId: string; plan: Plan; polygon: PlanPolygon; imageKey?: string; existingUnit?: PlanUnit; onClose: () => void; onSaved: () => void;
}) {
  const [choiceKey, setChoiceKey] = useState(existingUnit ? planUnitChoiceKey(existingUnit) : "");
  const [label, setLabel] = useState(existingUnit?.label || "");
  const pickableQ = useQuery<{ units: PickableUnit[] }>({
    queryKey: ["/api/properties", propertyId, "plan-pickable-units"],
    queryFn: async () => (await apiRequest("GET", `/api/properties/${propertyId}/plan-pickable-units`)).json(),
  });
  const units = pickableQ.data?.units || [];
  const choice = units.find(unit => planUnitChoiceKey(unit) === choiceKey);
  const save = useMutation({
    mutationFn: () => {
      if (choiceKey && !choice) throw new Error("That tenancy row is no longer available. Choose another row or leave the outline unlinked.");
      const fields = { unit_id: choice?.unit_id || null, tenancy_unit_id: choice?.tenancy_unit_id || null, label: label.trim() || choice?.unit_name || null };
      return existingUnit ? apiRequest("PATCH", `/api/plan-units/${existingUnit.id}`, fields) : apiRequest("POST", `/api/plans/${plan.id}/units`, { ...fields, polygon, imageKey });
    },
    onSuccess: onSaved,
  });
  return <Dialog open onOpenChange={value => { if (!value && !save.isPending) onClose(); }}><DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{existingUnit ? "Link this outline" : "Review unit boundary"}</DialogTitle></DialogHeader>
    <PropertyPlanPreview plan={plan} outlines={[{ id: "proposed-unit", polygon, selected: true }]} />
    <div className="space-y-3">
      <label className="block text-sm">Tenancy / property unit<select value={choiceKey} onChange={event => setChoiceKey(event.target.value)} disabled={pickableQ.isPending || pickableQ.isError} className="mt-1 w-full text-sm border rounded px-2 py-2 bg-background">
        <option value="">Leave unlinked</option>
        {choiceKey && !choice && <option value={choiceKey}>Previous link unavailable — choose again</option>}
        {units.map(unit => <option key={planUnitChoiceKey(unit)} value={planUnitChoiceKey(unit)}>{unit.unit_name}{unit.tenant_name ? ` · ${unit.tenant_name}` : ""}{unit.floor ? ` · ${unit.floor}` : ""}{!unit.tenancy_unit_id ? " · property unit only" : ""}</option>)}
      </select></label>
      <p className="text-xs text-muted-foreground">Link to the tenancy row to show its live rent, lease dates and occupancy. You can keep an outline unlinked and add the tenancy information later.</p>
      {pickableQ.isError && <p role="alert" className="text-sm text-destructive">Could not load tenancy rows. <button className="underline" onClick={() => pickableQ.refetch()}>Retry</button></p>}
      <label className="block text-sm">On-plan label (optional)<input value={label} onChange={event => setLabel(event.target.value)} placeholder={choice?.unit_name || "e.g. LU14"} className="mt-1 w-full text-sm border rounded px-2 py-2 bg-background" /></label>
      {save.isError && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
    </div><DialogFooter><Button variant="outline" disabled={save.isPending} onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending || pickableQ.isPending || pickableQ.isError}>{save.isPending ? "Saving…" : existingUnit ? "Save link" : "Save unit"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function UnitDetailDrawer({ unit, propertyId, onClose, onUpdated, onRelink, readOnly }: {
  unit: PlanUnit; propertyId: string; onClose: () => void; onUpdated: () => void; onRelink: () => void; readOnly: boolean;
}) {
  const { toast } = useToast();
  const saveOverride = useMutation({
    mutationFn: (value: string) => apiRequest("PATCH", `/api/plan-units/${unit.id}`, { status_override: value || null }),
    onSuccess: onUpdated,
    onError: error => toast({ title: "Could not save status", description: error.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/plan-units/${unit.id}`),
    onSuccess: () => { onUpdated(); onClose(); },
    onError: error => toast({ title: "Could not remove outline", description: error.message, variant: "destructive" }),
  });
  return <Dialog open onOpenChange={value => { if (!value) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm border-2" style={{ borderColor: STATUS_COLOURS[unit.status]?.stroke }} />{unit.unit_name || unit.label || "Unlinked outline"}</DialogTitle></DialogHeader>
    <div className="space-y-4 text-sm">
      <div className="rounded border p-3 bg-muted/20">
        <p className="text-xs text-muted-foreground">{unit.tenancy_unit_id ? "Live tenancy schedule" : "Property unit"}</p>
        <p className="font-semibold mt-1">{unit.tenant_name || (unit.status === "vacant" ? "Vacant" : "No tenant recorded")}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mt-3">
          <div><dt className="text-xs text-muted-foreground">Rent per year</dt><dd>{formatMoney(unit.rent_pa)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Area</dt><dd>{unit.unit_sqft == null ? "—" : `${Number(unit.unit_sqft).toLocaleString()} sq ft`}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Lease expiry</dt><dd>{formatDate(unit.lease_expiry)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Break date</dt><dd>{formatDate(unit.lease_break)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Rent review</dt><dd>{formatDate(unit.rent_review)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Status</dt><dd>{STATUS_COLOURS[unit.status]?.label || unit.status}</dd></div>
        </dl>
        {unit.marketing_status && <p className="mt-3 text-xs text-muted-foreground">Marketing: {unit.marketing_status}{unit.asking_rent != null ? ` · ${formatMoney(unit.asking_rent)} pa asking` : ""}</p>}
      </div>
      {!unit.tenancy_unit_id && <p className="text-sm text-muted-foreground">{unit.link_state === "ambiguous" ? "More than one tenancy row could match this property unit. Choose the correct row so the plan shows reliable information." : "Link this outline to a tenancy row to display its lease information."}</p>}
      <div className="flex flex-wrap gap-2">
        {!readOnly && <Button size="sm" variant="outline" onClick={onRelink}><Link2 className="w-3.5 h-3.5 mr-1" />{unit.tenancy_unit_id ? "Change tenancy link" : "Link to tenancy"}</Button>}
        <Link href={`/tenancy-schedule/${propertyId}${unit.tenancy_unit_id ? `?unitId=${encodeURIComponent(unit.tenancy_unit_id)}` : ""}`}><Button size="sm" variant="outline"><FileText className="w-3.5 h-3.5 mr-1" />{unit.tenancy_unit_id && !readOnly ? "Edit tenancy details" : "Open tenancy schedule"}</Button></Link>
        {unit.available_unit_id && <Link href={`/deals/letting?propertyId=${encodeURIComponent(propertyId)}`}><Button size="sm" variant="outline">Letting tracker</Button></Link>}
      </div>
      {Array.isArray(unit.active_deals) && unit.active_deals.length > 0 && <div><p className="text-xs text-muted-foreground mb-1">Active deals ({unit.active_deals.length})</p>{unit.active_deals.map(deal => <Link key={deal.id} href={`/deals/${deal.id}`} className="flex items-center gap-2 text-sm px-2 py-2 rounded hover:bg-muted"><Badge variant="outline" className="text-xs">{deal.status}</Badge><span className="truncate flex-1">{deal.name}</span><ChevronRight className="w-3.5 h-3.5" /></Link>)}</div>}
      {!readOnly && <div><Label className="text-xs text-muted-foreground">Plan status override</Label><div className="flex items-center gap-1.5 mt-1 flex-wrap">{["", "under_offer", "lease_event", "deal_in_progress", "vacant"].map(value => <button key={value || "auto"} onClick={() => saveOverride.mutate(value)} disabled={saveOverride.isPending} className={`text-xs px-2 py-1 rounded border ${(unit.status_override || "") === value ? "bg-foreground text-background border-foreground" : "bg-card hover:bg-muted"}`}>{value ? STATUS_COLOURS[value]?.label : "From schedule"}</button>)}</div><p className="text-xs text-muted-foreground mt-1">An override changes this outline’s colour only. Choose From schedule to follow the tenancy and deal information.</p></div>}
    </div><DialogFooter className="sm:justify-between gap-2">{!readOnly && <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => { if (confirm("Remove this outline from the plan? The tenancy record will be kept.")) remove.mutate(); }} className="text-destructive"><Trash2 className="w-3.5 h-3.5 mr-1" />Remove outline</Button>}<Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
  </DialogContent></Dialog>;
}
