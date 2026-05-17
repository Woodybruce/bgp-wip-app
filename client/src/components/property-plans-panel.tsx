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
  ExternalLink, FileText, Layers, MousePointer2, ChevronRight,
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

const STATUS_COLOURS: Record<string, { fill: string; stroke: string; label: string }> = {
  occupied:          { fill: "rgba(16,185,129,0.25)",  stroke: "#10b981", label: "Occupied" },
  lease_event:       { fill: "rgba(250,204,21,0.30)",  stroke: "#eab308", label: "Lease event <18m" },
  under_offer:       { fill: "rgba(249,115,22,0.30)",  stroke: "#f97316", label: "Under offer" },
  deal_in_progress:  { fill: "rgba(59,130,246,0.30)",  stroke: "#3b82f6", label: "Deal in progress" },
  vacant:            { fill: "rgba(244,63,94,0.30)",   stroke: "#f43f5e", label: "Vacant" },
  unlinked:          { fill: "rgba(148,163,184,0.20)", stroke: "#94a3b8", label: "Unlinked" },
  unknown:           { fill: "rgba(148,163,184,0.20)", stroke: "#94a3b8", label: "Unknown" },
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
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [pendingPoints, setPendingPoints] = useState<[number, number][]>([]);
  const [linkDialogPolygon, setLinkDialogPolygon] = useState<{ points: [number, number][] } | null>(null);
  const [selectedUnitForDrawer, setSelectedUnitForDrawer] = useState<PlanUnit | null>(null);

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
          {activePlan && (
            <>
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
            {/* Floor switcher */}
            <div className="flex items-center gap-1 flex-wrap">
              {plans.map(p => (
                <button
                  key={p.id}
                  onClick={() => setActivePlanId(p.id)}
                  className={`text-[11px] px-2 py-1 rounded border ${p.id === activePlan?.id ? "bg-foreground text-background border-foreground" : "bg-card hover:bg-muted"}`}
                  data-testid={`button-floor-${p.floor}`}
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
          />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Canvas — image + SVG overlay ──────────────────────────────────────

function PlanCanvas({
  plan, drawMode, pendingPoints, setPendingPoints, onFinishPolygon, onSelectUnit,
}: {
  plan: Plan;
  drawMode: boolean;
  pendingPoints: [number, number][];
  setPendingPoints: (p: [number, number][]) => void;
  onFinishPolygon: (points: [number, number][]) => void;
  onSelectUnit: (u: PlanUnit) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [hoverUnit, setHoverUnit] = useState<PlanUnit | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const unitsQ = useQuery<{ units: PlanUnit[] }>({
    queryKey: ["/api/plans", plan.id, "units"],
    queryFn: async () => {
      const r = await fetch(`/api/plans/${plan.id}/units`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const units = unitsQ.data?.units || [];

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
      onClick={handleClickOverlay}
      onDoubleClick={handleDoubleClickOverlay}
      data-testid="plan-canvas"
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
          return (
            <path
              key={u.id}
              d={d}
              fill={c.fill}
              stroke={c.stroke}
              strokeWidth={0.002}
              vectorEffect="non-scaling-stroke"
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

      {/* Hover tooltip */}
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
        <div className="absolute top-2 left-2 bg-card border rounded px-2 py-1 text-[10px] shadow-sm">
          Click to add point · double-click to close ({pendingPoints.length} points)
        </div>
      )}
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

  async function submit() {
    if (!file) { toast({ title: "Pick a file first" }); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("floor", floor);
      // Read natural size client-side so the server can store width/height.
      const url = URL.createObjectURL(file);
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = reject;
        im.src = url;
      }).catch(() => ({ w: 0, h: 0 }));
      URL.revokeObjectURL(url);
      fd.append("width", String(dims.w));
      fd.append("height", String(dims.h));
      const r = await fetch(`/api/properties/${propertyId}/plans`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const out = await r.json();
      toast({ title: "Plan uploaded" });
      onUploaded(out);
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
              <Label className="text-xs">Floor</Label>
              <select value={floor} onChange={(e) => setFloor(e.target.value)} className="w-full text-sm border rounded px-2 py-1 bg-background">
                {["Basement", "Ground", "First", "Second", "Third", "Upper", "Lower"].map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Image (PNG / JPG, max 25MB)</Label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-xs"
              />
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
  unit, planId, propertyId, onClose, onUpdated,
}: {
  unit: PlanUnit;
  planId: string;
  propertyId: string;
  onClose: () => void;
  onUpdated: () => void;
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

          {/* Status override */}
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
          <Button variant="ghost" size="sm" onClick={deletePolygon} className="text-rose-600 hover:text-rose-700">
            <Trash2 className="w-3 h-3 mr-1" /> Remove polygon
          </Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
