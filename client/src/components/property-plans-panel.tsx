// Property plans (Goad / leasing plan) — the visual version of the
// tenancy schedule. Image with SVG polygon overlay; polygons are
// linked to property_units so colour, tooltip, and click-drawer all
// derive from live tenancy + deal data.
//
// Status palette is shared with the leasing schedule's status bands
// so the two views read consistently.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Map as MapIcon, Upload, Plus, Trash2, Pencil, X as XIcon,
  ExternalLink, FileText, Layers, MousePointer2, ChevronRight, Sparkles,
} from "lucide-react";

interface Plan {
  id: string;
  property_id: string;
  floor: string;
  display_order: number;
  width: number | null;
  height: number | null;
  source: string | null;
  notes: string | null;
}

interface PlanUnit {
  id: string;
  plan_id: string;
  unit_id: string | null;
  label: string | null;
  polygon: { points: [number, number][] };
  status_override: string | null;
  unit_name: string | null;
  unit_sqft: number | null;
  unit_floor: string | null;
  tenant_name: string | null;
  rent_pa: number | null;
  lease_expiry: string | null;
  lease_break: string | null;
  rent_review: string | null;
  lease_status: string | null;
  leasing_schedule_unit_id: string | null;
  available_unit_id: string | null;
  marketing_status: string | null;
  asking_rent: number | null;
  active_deals: Array<{ id: string; name: string; status: string; tenant_id: string | null; deal_type: string | null }> | null;
  status: string;
}

interface PickableUnit {
  id: string;
  unit_name: string;
  floor: string | null;
  sqft: number | null;
  tenant_name: string | null;
  lease_status: string | null;
}

// Status colour palette. Fills are ALL transparent — colour comes
// through the stroke only, so the plan underneath stays fully
// legible. Hover bumps stroke width; tooltip / drawer carries the
// actual data.
const STATUS_COLOURS: Record<string, { fill: string; stroke: string; label: string }> = {
  occupied:          { fill: "transparent", stroke: "#10b981", label: "Occupied" },
  lease_event:       { fill: "transparent", stroke: "#eab308", label: "Lease event <18m" },
  under_offer:       { fill: "transparent", stroke: "#f97316", label: "Under offer" },
  deal_in_progress:  { fill: "transparent", stroke: "#3b82f6", label: "Deal in progress" },
  vacant:            { fill: "transparent", stroke: "#f43f5e", label: "Vacant" },
  unlinked:          { fill: "transparent", stroke: "#94a3b8", label: "Unlinked" },
  unknown:           { fill: "transparent", stroke: "#94a3b8", label: "Unknown" },
};

function formatMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return `£${Math.round(n).toLocaleString()}`;
}
function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function PropertyPlansPanel({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Plan upload is client-allowed on their own property (board parity),
  // but every other plan write — delete, floor rename, polygon add/edit,
  // auto-detect — is staff-only server-side. Hide those controls from
  // client viewers so they don't 403.
  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientViewer = !currentUser || currentUser.role === "Client" || !!currentUser.companyScopeId;
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [pendingPoints, setPendingPoints] = useState<[number, number][]>([]);
  const [linkDialogPolygon, setLinkDialogPolygon] = useState<{ points: [number, number][] } | null>(null);
  const [selectedUnitForDrawer, setSelectedUnitForDrawer] = useState<PlanUnit | null>(null);
  // URL-hash-driven highlight. The tenancy schedule's 'View on plan'
  // button writes #plan-unit-<unitName>; we read it here, switch to
  // the right floor (the plan that contains a polygon for it), and
  // pulse the polygon. Stays sticky until cleared so cross-floor
  // navigation keeps the highlight.
  const [highlightedLabel, setHighlightedLabel] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const m = window.location.hash.match(/^#plan-unit-(.+)$/);
      setHighlightedLabel(m ? decodeURIComponent(m[1]) : null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const plansQ = useQuery<{ plans: Plan[] }>({
    queryKey: ["/api/properties", propertyId, "plans"],
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/plans`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const plans = plansQ.data?.plans || [];
  const activePlan = useMemo(() => plans.find(p => p.id === activePlanId) || plans[0] || null, [plans, activePlanId]);

  // First-load: pick the first plan automatically.
  useEffect(() => {
    if (!activePlanId && plans.length > 0) setActivePlanId(plans[0].id);
  }, [plans, activePlanId]);

  return (
    <Card data-testid="property-plans-panel">
      <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MapIcon className="w-4 h-4" /> Plans
          <Badge variant="secondary" className="text-[10px]">{plans.length}</Badge>
        </CardTitle>
        <div className="flex items-center gap-1.5">
          <UploadPlanButton propertyId={propertyId} onUploaded={(p) => setActivePlanId(p.id)} />
          {activePlan && !isClientViewer && (
            <>
              <AutoDetectButton plan={activePlan} />
              <Button
                size="sm"
                variant={drawMode ? "default" : "outline"}
                className="h-7 text-[10px]"
                onClick={() => { setDrawMode(v => !v); setPendingPoints([]); }}
                data-testid="button-toggle-draw-mode"
              >
                {drawMode ? (<><MousePointer2 className="w-3 h-3 mr-1" /> Done</>) : (<><Pencil className="w-3 h-3 mr-1" /> Add unit</>)}
              </Button>
              <DeletePlanButton plan={activePlan} onDeleted={() => setActivePlanId(null)} />
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-2">
        {plans.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            No plans uploaded yet. Hit "Upload plan" to add a Goad or leasing-plan image (one per floor).
          </div>
        ) : (
          <>
            {/* Floor switcher. Double-click chip to rename. */}
            <div className="flex items-center gap-1 flex-wrap">
              {plans.map(p => (
                <button
                  key={p.id}
                  onClick={() => setActivePlanId(p.id)}
                  onDoubleClick={async () => {
                    if (isClientViewer) return;
                    const next = prompt(`Rename floor "${p.floor}":`, p.floor);
                    if (!next || next === p.floor) return;
                    try {
                      await fetch(`/api/plans/${p.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ floor: next }),
                      });
                      queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "plans"] });
                    } catch { /* swallow */ }
                  }}
                  className={`text-[11px] px-2 py-1 rounded border ${p.id === activePlan?.id ? "bg-foreground text-background border-foreground" : "bg-card hover:bg-muted"}`}
                  data-testid={`button-floor-${p.floor}`}
                  title={isClientViewer ? "Click to switch" : "Click to switch · double-click to rename"}
                >
                  <Layers className="w-2.5 h-2.5 inline mr-1" /> {p.floor}
                </button>
              ))}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
              {(["occupied", "lease_event", "under_offer", "deal_in_progress", "vacant", "unlinked"] as const).map(k => (
                <span key={k} className="inline-flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLOURS[k].fill, border: `1px solid ${STATUS_COLOURS[k].stroke}` }} />
                  {STATUS_COLOURS[k].label}
                </span>
              ))}
            </div>

            {/* Canvas */}
            {activePlan && (
              <PlanCanvas
                plan={activePlan}
                drawMode={drawMode}
                pendingPoints={pendingPoints}
                setPendingPoints={setPendingPoints}
                onFinishPolygon={(points) => { setLinkDialogPolygon({ points }); setPendingPoints([]); setDrawMode(false); }}
                onSelectUnit={(u) => setSelectedUnitForDrawer(u)}
                highlightedLabel={highlightedLabel}
                onAutoSwitchFloor={(targetPlanId) => setActivePlanId(targetPlanId)}
                allPlans={plans}
              />
            )}
          </>
        )}

        {/* Link-to-unit dialog */}
        {linkDialogPolygon && activePlan && (
          <LinkPolygonDialog
            propertyId={propertyId}
            planId={activePlan.id}
            polygon={linkDialogPolygon}
            onClose={() => setLinkDialogPolygon(null)}
            onSaved={() => {
              setLinkDialogPolygon(null);
              queryClient.invalidateQueries({ queryKey: ["/api/plans", activePlan.id, "units"] });
            }}
          />
        )}

        {/* Click-through drawer */}
        {selectedUnitForDrawer && activePlan && (
          <UnitDetailDrawer
            unit={selectedUnitForDrawer}
            planId={activePlan.id}
            propertyId={propertyId}
            onClose={() => setSelectedUnitForDrawer(null)}
            onUpdated={() => queryClient.invalidateQueries({ queryKey: ["/api/plans", activePlan.id, "units"] })}
            readOnly={isClientViewer}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Canvas — image + SVG overlay ──────────────────────────────────────

function PlanCanvas({
  plan, drawMode, pendingPoints, setPendingPoints, onFinishPolygon, onSelectUnit,
  highlightedLabel, onAutoSwitchFloor, allPlans,
}: {
  plan: Plan;
  drawMode: boolean;
  pendingPoints: [number, number][];
  setPendingPoints: (p: [number, number][]) => void;
  onFinishPolygon: (points: [number, number][]) => void;
  onSelectUnit: (u: PlanUnit) => void;
  highlightedLabel: string | null;
  onAutoSwitchFloor: (planId: string) => void;
  allPlans: Plan[];
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [hoverUnit, setHoverUnit] = useState<PlanUnit | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  // Pan + zoom state. Scale 1 = fit, max 6×. Pan in container pixels.
  // Wheel zooms toward the cursor (kid-glove UX). In draw mode we
  // suppress pan-drag so polygon clicks land cleanly.
  const [viewScale, setViewScale] = useState(1);
  const [viewTx, setViewTx] = useState(0);
  const [viewTy, setViewTy] = useState(0);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; tx0: number; ty0: number } | null>(null);

  function resetView() { setViewScale(1); setViewTx(0); setViewTy(0); }
  function zoomBy(delta: number, cx?: number, cy?: number) {
    const next = Math.max(1, Math.min(6, viewScale * delta));
    if (next === viewScale) return;
    if (cx != null && cy != null && innerRef.current) {
      // Zoom toward cursor: anchor the cursor's image-relative point.
      const rect = innerRef.current.getBoundingClientRect();
      const px = cx - rect.left;
      const py = cy - rect.top;
      const ratio = next / viewScale;
      setViewTx(viewTx - (px - rect.width / 2) * (ratio - 1));
      setViewTy(viewTy - (py - rect.height / 2) * (ratio - 1));
    }
    setViewScale(next);
  }
  // Wheel-zoom + click-and-drag pan were too easy to trigger while
  // scrolling the property page — the plan kept hijacking the wheel.
  // Zoom is now button-only (see the +/-/Reset row below the canvas);
  // pointer events stay live only in draw mode so polygon drawing
  // still works.
  function handleWheel(_e: React.WheelEvent) {
    // No-op — let the page scroll past the plan.
  }
  function handlePointerDown(e: React.PointerEvent) {
    if (!drawMode) return;
    // Drawing mode: don't initiate a pan on a polygon click — let the
    // path's onClick handle the drawer pop. Only start drag on the
    // image background.
    if ((e.target as HTMLElement).tagName?.toLowerCase() === "path") return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx0: viewTx, ty0: viewTy };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!drawMode || !dragRef.current) return;
    setViewTx(dragRef.current.tx0 + (e.clientX - dragRef.current.startX));
    setViewTy(dragRef.current.ty0 + (e.clientY - dragRef.current.startY));
  }
  function handlePointerUp() {
    dragRef.current = null;
  }

  const unitsQ = useQuery<{ units: PlanUnit[] }>({
    queryKey: ["/api/plans", plan.id, "units"],
    queryFn: async () => {
      const r = await fetch(`/api/plans/${plan.id}/units`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const units = unitsQ.data?.units || [];

  // Hash-driven highlight: when the tenancy schedule's "View on plan"
  // button writes #plan-unit-<name>, find the polygon and pulse it.
  // Match by label OR linked unit_name (case-insensitive trim-equal).
  const highlightedUnitId = useMemo(() => {
    if (!highlightedLabel) return null;
    const key = highlightedLabel.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key) return null;
    const hit = units.find(u => {
      const labelKey = (u.label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const nameKey = (u.unit_name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return labelKey === key || nameKey === key;
    });
    return hit?.id || null;
  }, [highlightedLabel, units]);

  // If no polygon on this plan matches the highlighted label, hint at
  // the user that another floor may have it. (Cross-floor auto-switch
  // would need pre-loading all plans' units — leaving that as a
  // future polish.)
  const crossFloorHint = highlightedLabel && !highlightedUnitId && allPlans.length > 1;

  // Convert click position → normalised 0-1 coords. Uses currentTarget's
  // bounding box, so it works whether the image renders at natural size
  // or scaled to fit a smaller container.
  function imgPosToNormalised(ev: React.MouseEvent<HTMLDivElement>): [number, number] {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  }

  function handleClickOverlay(ev: React.MouseEvent<HTMLDivElement>) {
    if (!drawMode) return;
    const pt = imgPosToNormalised(ev);
    setPendingPoints([...pendingPoints, pt]);
  }

  function handleDoubleClickOverlay() {
    if (!drawMode) return;
    if (pendingPoints.length >= 3) onFinishPolygon(pendingPoints);
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded border bg-muted/30"
      style={{ aspectRatio: naturalSize ? `${naturalSize.w} / ${naturalSize.h}` : "16 / 9" }}
      data-testid="plan-canvas"
    >
      {/* Zoom + pan transform wrapper. Click + drag + wheel all bind
          here so getBoundingClientRect reflects the transformed bounds —
          keeps draw-mode coords accurate at any zoom level. */}
      <div
        ref={innerRef}
        className="absolute inset-0"
        style={{
          transform: `translate(${viewTx}px, ${viewTy}px) scale(${viewScale})`,
          transformOrigin: "center center",
          cursor: drawMode ? (dragRef.current ? "grabbing" : "crosshair") : "default",
        }}
        onClick={handleClickOverlay}
        onDoubleClick={handleDoubleClickOverlay}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <img
          ref={imgRef}
          src={`/api/plans/${plan.id}/image`}
          alt={`${plan.floor} plan`}
          className="block w-full h-full object-contain pointer-events-none select-none"
          draggable={false}
          onLoad={(e) => {
            const im = e.currentTarget;
            if (im.naturalWidth > 0) setNaturalSize({ w: im.naturalWidth, h: im.naturalHeight });
          }}
        />

        {/* SVG overlay — viewBox 0..1 lets us draw with normalised coords. */}
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "none" }}
        >
        {units.map(u => {
          const c = STATUS_COLOURS[u.status] || STATUS_COLOURS.unknown;
          const pts = u.polygon?.points || [];
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ") + " Z";
          const isHighlight = u.id === highlightedUnitId;
          const isHover = hoverUnit?.id === u.id;
          // Hover provides the visual feedback that fills used to —
          // a subtle stroke-coloured wash + thicker stroke. Highlight
          // (hash-jump from the schedule) uses an indigo pulse on the
          // stroke only, so the plan underneath stays visible.
          return (
            <path
              key={u.id}
              d={d}
              fill={isHover ? c.stroke : "transparent"}
              fillOpacity={isHover ? 0.18 : 0}
              stroke={isHighlight ? "#6366f1" : c.stroke}
              strokeWidth={isHighlight ? 0.006 : (isHover ? 0.004 : 0.002)}
              vectorEffect="non-scaling-stroke"
              className={isHighlight ? "animate-pulse" : ""}
              style={{ pointerEvents: drawMode ? "none" : "auto", cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); onSelectUnit(u); }}
              onMouseEnter={(e) => {
                setHoverUnit(u);
                const rect = (e.currentTarget.ownerSVGElement?.getBoundingClientRect());
                if (rect) setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
              }}
              onMouseLeave={() => { setHoverUnit(null); setTooltipPos(null); }}
            />
          );
        })}

        {/* Pending polygon (being drawn) */}
        {drawMode && pendingPoints.length > 0 && (
          <>
            {pendingPoints.length >= 3 && (
              <path
                d={pendingPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ") + " Z"}
                fill="rgba(99,102,241,0.15)"
                stroke="#6366f1"
                strokeWidth={0.003}
                strokeDasharray="0.01 0.005"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {pendingPoints.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={0.005} fill="#6366f1" />
            ))}
          </>
        )}
        </svg>
      </div>

      {/* Hover tooltip — outside the transformed wrapper so it doesn't
          scale with the zoom. Position still works because tooltipPos
          is computed against the inner's bounding rect. */}
      {hoverUnit && tooltipPos && (
        <div
          className="absolute pointer-events-none bg-popover border rounded shadow-md px-2 py-1.5 text-[11px] z-10"
          style={{ left: tooltipPos.x + 8, top: tooltipPos.y + 8, maxWidth: 240 }}
        >
          <div className="font-semibold truncate">
            {hoverUnit.unit_name || hoverUnit.label || "Unit"}
            {hoverUnit.tenant_name && <span className="text-muted-foreground font-normal"> · {hoverUnit.tenant_name}</span>}
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5 flex-wrap">
            <Badge variant="outline" className="text-[9px]" style={{ borderColor: STATUS_COLOURS[hoverUnit.status]?.stroke }}>
              {STATUS_COLOURS[hoverUnit.status]?.label || hoverUnit.status}
            </Badge>
            {hoverUnit.unit_sqft && <span>{hoverUnit.unit_sqft.toLocaleString()} sqft</span>}
            {hoverUnit.rent_pa && <span>· {formatMoney(hoverUnit.rent_pa)}/yr</span>}
            {hoverUnit.lease_expiry && <span>· exp {formatDate(hoverUnit.lease_expiry)}</span>}
          </div>
        </div>
      )}

      {drawMode && (
        <div className="absolute top-2 left-2 bg-card border rounded px-2 py-1 text-[10px] shadow-sm z-10">
          Click to add point · double-click to close ({pendingPoints.length} points)
        </div>
      )}

      {crossFloorHint && (
        <div className="absolute top-2 left-2 right-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded px-2 py-1 text-[11px] text-amber-900 dark:text-amber-200 flex items-center gap-2 z-10">
          <span className="font-medium">"{highlightedLabel}"</span> isn't on this floor — switch floors to find it, or add it via "Add unit".
        </div>
      )}

      {/* Zoom + pan controls. Sit bottom-right so they don't overlap
          with the cross-floor banner. */}
      <div className="absolute bottom-2 right-2 flex flex-col gap-1 z-10">
        <button
          onClick={() => zoomBy(1.25)}
          className="w-7 h-7 rounded border bg-card hover:bg-muted text-xs font-semibold shadow-sm"
          title="Zoom in (scroll wheel up)"
        >+</button>
        <button
          onClick={() => zoomBy(1 / 1.25)}
          className="w-7 h-7 rounded border bg-card hover:bg-muted text-xs font-semibold shadow-sm"
          title="Zoom out (scroll wheel down)"
        >−</button>
        <button
          onClick={resetView}
          className="w-7 h-7 rounded border bg-card hover:bg-muted text-[9px] font-semibold shadow-sm"
          title="Reset zoom + pan"
        >⤧</button>
      </div>
      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground bg-card/80 border rounded px-1.5 py-0.5 z-10 pointer-events-none">
        {Math.round(viewScale * 100)}% · drag to pan · wheel to zoom
      </div>
    </div>
  );
}

// ─── Upload + delete buttons ──────────────────────────────────────────

function UploadPlanButton({ propertyId, onUploaded }: { propertyId: string; onUploaded: (p: Plan) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [floor, setFloor] = useState("Ground");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Render a single PDF page to a PNG blob using pdfjs-dist. 2× zoom
  // keeps text on Goad-style plans crisp without blowing storage out.
  async function pdfPageToPng(pdfFile: File, pageNumber: number): Promise<{ blob: Blob; width: number; height: number }> {
    const pdfjs: any = await import("pdfjs-dist");
    // pdfjs needs its worker. Vite-served fallback: data URL with the
    // worker module. The dist ships a worker as an ESM module.
    if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      // Use CDN worker matching the installed version (works offline once cached;
      // package version is bundled at build time).
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    }
    const buf = await pdfFile.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const page = await doc.getPage(pageNumber);
    // 3× zoom — keeps tiny unit-number labels readable. Sharp at 4× but
    // PNG size blows past Claude vision's input limit on dense plans.
    const viewport = page.getViewport({ scale: 3 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob: Blob = await new Promise(r => canvas.toBlob(b => r(b!), "image/png"));
    return { blob, width: canvas.width, height: canvas.height };
  }

  async function uploadOnePage(blob: Blob, width: number, height: number, floorLabel: string, filename: string): Promise<Plan> {
    const fd = new FormData();
    fd.append("file", new File([blob], filename, { type: "image/png" }));
    fd.append("floor", floorLabel);
    fd.append("source", "leasing-plan");
    fd.append("width", String(width));
    fd.append("height", String(height));
    const r = await fetch(`/api/properties/${propertyId}/plans`, {
      method: "POST", body: fd, credentials: "include",
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    return r.json();
  }

  async function submit() {
    if (!file) { toast({ title: "Pick a file first" }); return; }
    setUploading(true);
    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        // Multi-page PDFs become one plan per page. Floor names auto-
        // assigned: page 1 → user's selected floor, page 2 → "First",
        // page 3 → "Second", etc. User can rename via the API after.
        const pdfjs: any = await import("pdfjs-dist");
        if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        }
        const buf = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        const fallbackFloors = ["Ground", "First", "Second", "Third", "Fourth"];
        let firstPlan: Plan | null = null;
        for (let i = 1; i <= doc.numPages; i++) {
          const { blob, width, height } = await pdfPageToPng(file, i);
          const floorLabel = i === 1 ? floor : (fallbackFloors[i - 1] || `Page ${i}`);
          const plan = await uploadOnePage(blob, width, height, floorLabel, file.name.replace(/\.pdf$/i, "") + `-p${i}.png`);
          if (i === 1) firstPlan = plan;
        }
        toast({ title: `Uploaded ${doc.numPages} page${doc.numPages === 1 ? "" : "s"}`, description: "Each page became its own floor plan." });
        if (firstPlan) onUploaded(firstPlan);
      } else {
        // Image path — single page upload.
        const url = URL.createObjectURL(file);
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
          im.onerror = reject;
          im.src = url;
        }).catch(() => ({ w: 0, h: 0 }));
        URL.revokeObjectURL(url);
        const fd = new FormData();
        fd.append("file", file);
        fd.append("floor", floor);
        fd.append("width", String(dims.w));
        fd.append("height", String(dims.h));
        const r = await fetch(`/api/properties/${propertyId}/plans`, { method: "POST", body: fd, credentials: "include" });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        const out = await r.json();
        toast({ title: "Plan uploaded" });
        onUploaded(out);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "plans"] });
      setOpen(false);
      setFile(null);
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setOpen(true)} data-testid="button-upload-plan">
        <Upload className="w-3 h-3 mr-1" /> Upload plan
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload property plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Floor (page 1 / single image)</Label>
              <select value={floor} onChange={(e) => setFloor(e.target.value)} className="w-full text-sm border rounded px-2 py-1 bg-background">
                {["Basement", "Ground", "First", "Second", "Third", "Upper", "Lower"].map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">File (PDF / PNG / JPG, max 25MB)</Label>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/jpg"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-xs"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Multi-page PDFs become one plan per page (page 1 = the floor you selected, page 2 = First, page 3 = Second, etc — rename after).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={uploading || !file}>{uploading ? "Uploading…" : "Upload"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// AI auto-detect button — sends the plan image to Claude vision, gets
// back labelled bboxes, creates polygons for every detection (matched
// or otherwise). Idempotent: re-running skips labels that already
// exist on this plan.
function AutoDetectButton({ plan }: { plan: Plan }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [running, setRunning] = useState<null | "fast" | "hq">(null);

  async function run(mode: "fast" | "hq") {
    const label = mode === "hq" ? "high-quality (4-tile)" : "standard (single pass)";
    if (!confirm(`Run ${label} auto-detect on the ${plan.floor} plan? Adds polygons for every unit Claude finds; existing labels are kept.`)) return;
    setRunning(mode);
    try {
      const r = await fetch(`/api/plans/${plan.id}/auto-detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ highQuality: mode === "hq" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const out = await r.json();
      toast({
        title: `Detected ${out.detected} units (${out.mode})`,
        description: `Created ${out.created} polygons · ${out.matched} matched to a CRM unit · ${out.skipped_existing} skipped (already on plan).`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/plans", plan.id, "units"] });
    } catch (e: any) {
      toast({ title: "Auto-detect failed", description: e?.message, variant: "destructive" });
    } finally {
      setRunning(null);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-[10px]"
        disabled={running !== null}
        onClick={() => run("fast")}
        data-testid="button-auto-detect-plan"
        title="Single-pass Opus vision call. Fast (~30s), best for small / clean plans."
      >
        <Sparkles className={`w-3 h-3 mr-1 ${running === "fast" ? "animate-spin" : ""}`} /> {running === "fast" ? "Detecting…" : "Auto-detect"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-[10px]"
        disabled={running !== null}
        onClick={() => run("hq")}
        data-testid="button-auto-detect-plan-hq"
        title="Splits the plan into 4 tiles, runs Opus on each, merges + dedupes. ~4× slower / costlier but reads tiny unit labels on dense centres."
      >
        <Sparkles className={`w-3 h-3 mr-1 ${running === "hq" ? "animate-spin" : ""}`} /> {running === "hq" ? "Detecting (HQ)…" : "Auto-detect HQ"}
      </Button>
    </>
  );
}

function DeletePlanButton({ plan, onDeleted }: { plan: Plan; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-[10px]"
      onClick={async () => {
        if (!confirm(`Delete the ${plan.floor} plan? All polygons on it will be removed.`)) return;
        try {
          const r = await fetch(`/api/plans/${plan.id}`, { method: "DELETE", credentials: "include" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          toast({ title: "Plan deleted" });
          onDeleted();
          queryClient.invalidateQueries({ queryKey: ["/api/properties", plan.property_id, "plans"] });
        } catch (e: any) {
          toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
        }
      }}
      title={`Delete ${plan.floor} plan`}
    >
      <Trash2 className="w-3 h-3" />
    </Button>
  );
}

// ─── Link-polygon-to-unit dialog ──────────────────────────────────────

function LinkPolygonDialog({
  propertyId, planId, polygon, onClose, onSaved,
}: {
  propertyId: string;
  planId: string;
  polygon: { points: [number, number][] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [unitId, setUnitId] = useState<string>("");
  const [label, setLabel] = useState("");

  const pickableQ = useQuery<{ units: PickableUnit[] }>({
    queryKey: ["/api/properties", propertyId, "plan-pickable-units"],
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/plan-pickable-units`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  async function save() {
    try {
      const r = await fetch(`/api/plans/${planId}/units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          unit_id: unitId || null,
          label: label.trim() || null,
          polygon,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      toast({ title: "Unit added" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link polygon to unit</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Property unit (optional)</Label>
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className="w-full text-sm border rounded px-2 py-1 bg-background"
            >
              <option value="">— leave unlinked —</option>
              {(pickableQ.data?.units || []).map(u => (
                <option key={u.id} value={u.id}>
                  {u.unit_name}{u.tenant_name ? ` · ${u.tenant_name}` : ""}{u.sqft ? ` · ${u.sqft.toLocaleString()} sqft` : ""}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">
              Picking a unit lets us colour the polygon by lease status + show tenant on hover.
            </p>
          </div>
          <div>
            <Label className="text-xs">On-plan label (optional)</Label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. LU14"
              className="w-full text-sm border rounded px-2 py-1 bg-background"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save unit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Click-through drawer ─────────────────────────────────────────────

function UnitDetailDrawer({
  unit, planId, propertyId, onClose, onUpdated, readOnly,
}: {
  unit: PlanUnit;
  planId: string;
  propertyId: string;
  onClose: () => void;
  onUpdated: () => void;
  readOnly?: boolean;
}) {
  const { toast } = useToast();
  const [override, setOverride] = useState(unit.status_override || "");
  const [saving, setSaving] = useState(false);

  async function saveOverride(value: string) {
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/plan-units/${unit.id}`, { status_override: value || null });
      setOverride(value);
      onUpdated();
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deletePolygon() {
    if (!confirm("Remove this polygon from the plan?")) return;
    try {
      await apiRequest("DELETE", `/api/plan-units/${unit.id}`, {});
      onUpdated();
      onClose();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: STATUS_COLOURS[unit.status]?.fill, border: `1px solid ${STATUS_COLOURS[unit.status]?.stroke}` }} />
            {unit.unit_name || unit.label || "Unlinked polygon"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          {/* Tenant + lease snapshot */}
          {unit.tenant_name && (
            <div className="rounded border p-2 bg-muted/30">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tenant</div>
              <div className="font-semibold text-sm">{unit.tenant_name}</div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {unit.rent_pa != null && <div><div className="text-[10px] text-muted-foreground">Rent</div><div>{formatMoney(unit.rent_pa)} pa</div></div>}
                {unit.unit_sqft != null && <div><div className="text-[10px] text-muted-foreground">Size</div><div>{unit.unit_sqft.toLocaleString()} sqft</div></div>}
                {unit.lease_expiry && <div><div className="text-[10px] text-muted-foreground">Expiry</div><div>{formatDate(unit.lease_expiry)}</div></div>}
                {unit.lease_break && <div><div className="text-[10px] text-muted-foreground">Break</div><div>{formatDate(unit.lease_break)}</div></div>}
              </div>
            </div>
          )}

          {/* Vacancy snapshot */}
          {unit.marketing_status && !unit.tenant_name && (
            <div className="rounded border p-2 bg-muted/30">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Availability</div>
              <div className="font-semibold text-sm">{unit.marketing_status}</div>
              {unit.asking_rent != null && <div>{formatMoney(unit.asking_rent)} pa asking</div>}
            </div>
          )}

          {/* Active deals */}
          {Array.isArray(unit.active_deals) && unit.active_deals.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Active deals ({unit.active_deals.length})</div>
              <div className="space-y-0.5">
                {unit.active_deals.map(d => (
                  <Link key={d.id} href={`/deals/${d.id}`}>
                    <div className="flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded hover:bg-muted cursor-pointer">
                      <Badge variant="outline" className="text-[9px]">{d.status}</Badge>
                      <span className="truncate flex-1">{d.name}</span>
                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Status override — staff-only PATCH; hidden for client viewers */}
          {!readOnly && (
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Status override</Label>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {["", "under_offer", "lease_event", "deal_in_progress", "vacant"].map(v => (
                <button
                  key={v || "auto"}
                  onClick={() => saveOverride(v)}
                  disabled={saving}
                  className={`text-[10px] px-2 py-0.5 rounded border ${override === v ? "bg-foreground text-background border-foreground" : "bg-card hover:bg-muted"}`}
                >
                  {v ? STATUS_COLOURS[v]?.label : "auto from schedule"}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              "auto from schedule" derives colour from the live lease / deal data; override forces a state on this polygon only.
            </p>
          </div>
          )}

          {/* Jump links */}
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t">
            {unit.leasing_schedule_unit_id && (
              <Link href={`/properties/${propertyId}/leasing-schedule`}>
                <Button size="sm" variant="outline" className="h-7 text-[10px]"><FileText className="w-3 h-3 mr-1" /> Leasing schedule</Button>
              </Link>
            )}
            {unit.available_unit_id && (
              <Link href={`/available-units?propertyId=${propertyId}`}>
                <Button size="sm" variant="outline" className="h-7 text-[10px]"><ExternalLink className="w-3 h-3 mr-1" /> Available unit</Button>
              </Link>
            )}
            {unit.unit_id && (
              <Link href={`/properties/${propertyId}/units/${unit.unit_id}`}>
                <Button size="sm" variant="outline" className="h-7 text-[10px]"><ExternalLink className="w-3 h-3 mr-1" /> Unit board</Button>
              </Link>
            )}
          </div>
        </div>

        <DialogFooter className="justify-between">
          {!readOnly ? (
            <Button variant="ghost" size="sm" onClick={deletePolygon} className="text-rose-600 hover:text-rose-700">
              <Trash2 className="w-3 h-3 mr-1" /> Remove polygon
            </Button>
          ) : <span />}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
