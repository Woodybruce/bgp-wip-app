// Cropping a plan to the part of the page that matters (Woody, 2026-11-16:
// "ability to crop the page when loading up"). The box is dragged over the
// picture; the server cuts the image and moves the outlines with it
// (shared/plan-crop.ts holds the rules).
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { PLAN_CROP_MIN_SIDE, type PlanCropRect } from "@shared/plan-crop";
import { usePropertyPlanImage } from "./property-plan-preview";
import type { PropertyPlan as Plan, PropertyPlanUnit as PlanUnit } from "./property-plan-types";

export const WHOLE_PAGE: PlanCropRect = { x: 0, y: 0, width: 1, height: 1 };
export const isWholePage = (rect: PlanCropRect) => rect.width > 0.995 && rect.height > 0.995;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
type Grip = { left: boolean; right: boolean; top: boolean; bottom: boolean };
type Drag =
  | { kind: "new"; ax: number; ay: number }
  | { kind: "move"; dx: number; dy: number }
  | { kind: "size"; grip: Grip; start: PlanCropRect };

// The picture with the box to drag. Drag on the page for a new box, inside
// the box to move it, an edge or a corner to resize it.
export function PlanCropBox({ plan, rect, onChange, outlines = [], disabled = false }: {
  plan: Plan; rect: PlanCropRect; onChange: (rect: PlanCropRect) => void;
  outlines?: Array<{ id: string; points: [number, number][] }>; disabled?: boolean;
}) {
  const image = usePropertyPlanImage(plan.id, plan.storage_key);
  const [size, setSize] = useState({ w: plan.width || 1600, h: plan.height || 1000 });
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const whole = isWholePage(rect);
  const point = (event: React.PointerEvent) => {
    const box = boxRef.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height), box };
  };
  function start(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || !image.src) return;
    const { x, y, box } = point(event);
    const near = (a: number, b: number, span: number) => Math.abs(a - b) * span <= 10;
    const within = x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
    const grip: Grip = {
      left: near(x, rect.x, box.width), right: near(x, rect.x + rect.width, box.width),
      top: near(y, rect.y, box.height), bottom: near(y, rect.y + rect.height, box.height),
    };
    const onEdge = !whole && (grip.left || grip.right || grip.top || grip.bottom)
      && x >= rect.x - 10 / box.width && x <= rect.x + rect.width + 10 / box.width
      && y >= rect.y - 10 / box.height && y <= rect.y + rect.height + 10 / box.height;
    if (onEdge) drag.current = { kind: "size", grip, start: rect };
    else if (within && !whole) drag.current = { kind: "move", dx: x - rect.x, dy: y - rect.y };
    else drag.current = { kind: "new", ax: x, ay: y };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function move(event: React.PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    const { x, y } = point(event);
    if (current.kind === "new") {
      const left = Math.min(current.ax, x), top = Math.min(current.ay, y);
      onChange({ x: left, y: top, width: Math.abs(x - current.ax), height: Math.abs(y - current.ay) });
    } else if (current.kind === "move") {
      onChange({ ...rect, x: Math.min(1 - rect.width, Math.max(0, x - current.dx)), y: Math.min(1 - rect.height, Math.max(0, y - current.dy)) });
    } else {
      let left = current.start.x, top = current.start.y, right = current.start.x + current.start.width, bottom = current.start.y + current.start.height;
      if (current.grip.left) left = Math.min(x, right - PLAN_CROP_MIN_SIDE);
      else if (current.grip.right) right = Math.max(x, left + PLAN_CROP_MIN_SIDE);
      if (current.grip.top) top = Math.min(y, bottom - PLAN_CROP_MIN_SIDE);
      else if (current.grip.bottom) bottom = Math.max(y, top + PLAN_CROP_MIN_SIDE);
      onChange({ x: left, y: top, width: right - left, height: bottom - top });
    }
  }
  function end() {
    if (!drag.current) return;
    const wasNew = drag.current.kind === "new";
    drag.current = null;
    // A click, or a box too small to be a crop, goes back to the whole page.
    if (wasNew && (rect.width < PLAN_CROP_MIN_SIDE || rect.height < PLAN_CROP_MIN_SIDE)) onChange(WHOLE_PAGE);
  }
  const pct = (value: number) => `${value * 100}%`;
  const shade = "absolute bg-black/45 pointer-events-none";
  const handle = "absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-background border border-foreground pointer-events-none";
  return <div className="space-y-1.5">
    <div ref={boxRef} className="relative mx-auto select-none overflow-hidden rounded border bg-muted/20" data-testid="plan-crop-box"
      style={{ width: `min(100%, calc(58vh * ${size.w / size.h}))`, aspectRatio: `${size.w} / ${size.h}`, touchAction: "none", cursor: disabled ? "default" : "crosshair" }}
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {image.src && <img src={image.src} alt={`${plan.floor} plan`} draggable={false} className="block w-full h-full pointer-events-none"
        onLoad={event => setSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })} />}
      {image.isPending && <div role="status" className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Loading the page…</div>}
      {image.isError && <div role="alert" className="absolute inset-0 flex items-center justify-center text-sm text-destructive bg-background/95">The page could not be loaded.</div>}
      {outlines.length > 0 && <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
        {outlines.map(outline => <polygon key={outline.id} points={outline.points.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="#6366f1" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
      </svg>}
      {image.src && !whole && <>
        <div className={shade} style={{ left: 0, top: 0, right: 0, height: pct(rect.y) }} />
        <div className={shade} style={{ left: 0, top: pct(rect.y + rect.height), right: 0, bottom: 0 }} />
        <div className={shade} style={{ left: 0, top: pct(rect.y), width: pct(rect.x), height: pct(rect.height) }} />
        <div className={shade} style={{ left: pct(rect.x + rect.width), top: pct(rect.y), right: 0, height: pct(rect.height) }} />
        <div className="absolute border-2 border-background outline outline-1 outline-foreground pointer-events-none" data-testid="plan-crop-area"
          style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.width), height: pct(rect.height) }} />
        {[0, 0.5, 1].flatMap(fx => [0, 0.5, 1].filter(fy => !(fx === 0.5 && fy === 0.5)).map(fy =>
          <span key={`${fx}-${fy}`} className={handle} style={{ left: pct(rect.x + rect.width * fx), top: pct(rect.y + rect.height * fy) }} />))}
      </>}
    </div>
    <p className="text-xs text-muted-foreground text-center">
      {whole ? "Drag a box over the part of the page to keep: the drawing without its legend, title block or margins."
        : "Drag inside the box to move it, or an edge or corner to resize it. Click outside it to start again."}
    </p>
  </div>;
}

// The two changes to a plan's picture, with every list that reads the plan
// refreshed after them.
export function usePlanCrop(propertyId: string) {
  const queryClient = useQueryClient();
  const refresh = (planId: string) => {
    void queryClient.invalidateQueries({ queryKey: ["/api/plans", planId] });
    void queryClient.invalidateQueries({ queryKey: ["/api/plans", "property-links", propertyId] });
    void queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "units"] });
    return queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "plans"] });
  };
  type Result = { plan: Plan; kept: number; removed: number; scanning: number };
  return {
    async crop(plan: Plan, rect: PlanCropRect, scan = false): Promise<Result> {
      const result = await (await apiRequest("POST", `/api/plans/${plan.id}/crop`, { ...rect, imageKey: plan.storage_key, scan })).json();
      await refresh(plan.id);
      return result;
    },
    async restore(plan: Plan): Promise<Result> {
      const result = await (await apiRequest("POST", `/api/plans/${plan.id}/crop/undo`, {})).json();
      await refresh(plan.id);
      return result;
    },
  };
}

// Crop a plan that is already loaded: the box over the page, with the saved
// outlines drawn so it is plain what the crop must keep.
export function PlanCropDialog({ plan, onClose, onCropped }: { plan: Plan; onClose: () => void; onCropped?: (result: { plan: Plan; kept: number; removed: number; scanning: number }) => void }) {
  const [rect, setRect] = useState<PlanCropRect>(WHOLE_PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = usePlanCrop(plan.property_id);
  const unitsQ = useQuery<{ units: PlanUnit[] }>({
    queryKey: ["/api/plans", plan.id, "units"],
    queryFn: async () => (await apiRequest("GET", `/api/plans/${plan.id}/units`)).json(),
  });
  const outlines = (unitsQ.data?.units || []).map(unit => ({ id: unit.id, points: unit.polygon.points }));
  async function crop() {
    setBusy(true); setError(null);
    try { const result = await actions.crop(plan, rect); onCropped?.(result); onClose(); }
    catch (cause: any) { setError(cause?.message || "The plan could not be cropped."); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Crop the {plan.floor} plan</DialogTitle></DialogHeader>
      <PlanCropBox plan={plan} rect={rect} onChange={setRect} outlines={outlines} disabled={busy} />
      {outlines.length > 0 && <p className="text-xs text-muted-foreground">The {outlines.length} saved outline{outlines.length === 1 ? "" : "s"} move with the plan. A crop that would cut through one, or leave a matched unit outside, is not made.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button disabled={busy || isWholePage(rect)} onClick={crop} data-testid="button-plan-crop-apply">{busy ? "Cropping…" : "Crop to this area"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
