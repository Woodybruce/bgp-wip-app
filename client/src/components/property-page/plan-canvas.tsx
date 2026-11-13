// The plan itself on the plan-led property page: the plan image with outlines
// drawn over it, zoomed and panned in place (wheel, drag, pinch). It knows
// nothing about units. The host hands it shapes (an outline, its colours, a
// short label) and hears which one was clicked, or, in "click inside the unit"
// mode, where on the plan the click landed.
//
// Panning and zooming move one transformed layer through a ref, so the
// outlines are not re-rendered on every pointer move. Line weights and labels
// follow a coarser copy of the zoom that changes in steps.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { Loader2, Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePropertyPlanImage } from "@/components/property-plan-preview";
import { interiorPoint } from "@shared/plan-geometry";
import type { PropertyPlanPolygon } from "@shared/property-plan-scan";
import { PROPOSAL_HEX } from "./unit-state";

export interface CanvasShape {
  id: string;
  polygon: PropertyPlanPolygon;   // points normalised 0..1 of the plan image
  fill: string | null;            // hex, or null for no fill
  stroke: string;                 // hex
  dashed?: boolean;
  dim?: boolean;                  // drawn faint: the list's filter hides this unit
  label?: string | null;          // short text drawn inside when there is room
  title?: string;                 // tooltip and aria-label
}

type View = { x: number; y: number; s: number };
type Geometry = { points: string; cx: number; cy: number; x0: number; y0: number; w: number; h: number };
const MAX_ZOOM = 12;
const CLICK_SLOP = 5;

function shapeGeometry(polygon: PropertyPlanPolygon, W: number, H: number): Geometry | null {
  const raw = Array.isArray(polygon?.points) ? polygon.points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [];
  if (raw.length < 3) return null;
  const xs = raw.map(p => p[0] * W), ys = raw.map(p => p[1] * H);
  const inside = interiorPoint(raw.map(p => ({ x: p[0], y: p[1] })));
  const cx = Number.isFinite(inside?.x) ? inside.x * W : (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = Number.isFinite(inside?.y) ? inside.y * H : (Math.min(...ys) + Math.max(...ys)) / 2;
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { points: raw.map((p, i) => `${xs[i]},${ys[i]}`).join(" "), cx, cy, x0, y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

// The outlines. Their order never changes on hover or selection (moving a
// node under the pointer makes browsers fire leave and enter again); the
// hovered and selected shapes are drawn a second time on top instead.
const Outlines = memo(function Outlines({ shapes, geometry, scale, onEnter, onLeave, onKey, onFocusShape }: {
  shapes: CanvasShape[];
  geometry: Map<string, Geometry>;
  scale: number;
  onEnter: (id: string) => void;
  onLeave: () => void;
  onKey: (id: string, key: string) => boolean;
  onFocusShape: (id: string, element: Element) => void;
}) {
  const ordered = useMemo(() => [...shapes.filter(s => s.dim), ...shapes.filter(s => !s.dim)], [shapes]);
  return (
    <>
      {ordered.map(shape => {
        const g = geometry.get(shape.id);
        if (!g) return null;
        return (
          <polygon
            key={shape.id} points={g.points} data-shape-id={shape.id} data-testid={`plan-shape-${shape.id}`}
            fill={shape.fill || "transparent"} fillOpacity={shape.fill ? (shape.dim ? 0.08 : 0.38) : 0}
            stroke={shape.stroke} strokeOpacity={shape.dim ? 0.35 : 1} strokeWidth={1.5 / scale}
            strokeDasharray={shape.dashed ? `${6 / scale} ${4 / scale}` : undefined} strokeLinejoin="round"
            role="button" tabIndex={0} aria-label={shape.title || shape.label || "Outline"}
            className="cursor-pointer outline-none focus-visible:stroke-current focus-visible:[fill-opacity:0.6]"
            onPointerEnter={() => onEnter(shape.id)} onPointerLeave={onLeave}
            onKeyDown={event => { if (onKey(shape.id, event.key)) event.preventDefault(); }}
            onFocus={event => onFocusShape(shape.id, event.currentTarget)}
          >
            {shape.title && <title>{shape.title}</title>}
          </polygon>
        );
      })}
    </>
  );
});

const Labels = memo(function Labels({ shapes, geometry, scale }: { shapes: CanvasShape[]; geometry: Map<string, Geometry>; scale: number }) {
  return (
    <g pointerEvents="none" fontSize={11 / scale} fontWeight={600} textAnchor="middle" dominantBaseline="central">
      {shapes.map(shape => {
        const g = geometry.get(shape.id);
        if (!shape.label || !g || g.w * scale < 46 || g.h * scale < 16) return null;
        return (
          <text key={shape.id} x={g.cx} y={g.cy} fill="#0f172a" fillOpacity={shape.dim ? 0.45 : 1} stroke="#ffffff" strokeOpacity={0.9} strokeWidth={3 / scale} style={{ paintOrder: "stroke" }}>
            {shape.label.length > 14 ? `${shape.label.slice(0, 13)}…` : shape.label}
          </text>
        );
      })}
    </g>
  );
});

export function PlanCanvas({ planId, floor, width, height, shapes, selectedId, hoverId = null, onSelect, onHover, focusId = null, focusKey = 0, pick = null, preview = null, toolbar, className }: {
  planId: string;
  floor: string;
  width: number | null;           // image pixel size when known (else read from the loaded image)
  height: number | null;
  shapes: CanvasShape[];
  selectedId: string | null;
  hoverId?: string | null;        // a shape hovered elsewhere (the list)
  onSelect: (id: string) => void;
  onHover?: (id: string | null) => void;
  focusId?: string | null;        // when this changes to a shape's id, bring that shape into view
  focusKey?: number;              // bump it to bring the same shape into view again
  pick?: { hint: string; busy?: boolean; onPick: (point: { x: number; y: number }) => void } | null;
  preview?: PropertyPlanPolygon | null;   // a traced outline waiting to be saved
  toolbar?: ReactNode;
  className?: string;
}) {
  const image = usePropertyPlanImage(planId);
  const [natural, setNatural] = useState<{ planId: string; w: number; h: number } | null>(null);
  const W = (natural?.planId === planId ? natural.w : 0) || width || 0;
  const H = (natural?.planId === planId ? natural.h : 0) || height || 0;

  const viewportRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: 0, y: 0, s: 1 });
  const fitScale = useRef(1);
  const atFit = useRef(true);
  const frame = useRef(0);
  const [scale, setScale] = useState(1);   // the coarse zoom: line weights and labels
  const [ready, setReady] = useState(false);
  const [ownHover, setOwnHover] = useState<string | null>(null);

  // The latest props for handlers that are attached once.
  const live = useRef({ onSelect, onHover, pick, W, H });
  live.current = { onSelect, onHover, pick, W, H };

  const apply = useCallback((animate = false) => {
    const layer = layerRef.current;
    if (!layer) return;
    const { x, y, s } = view.current;
    layer.style.transition = animate ? "transform 200ms ease" : "none";
    layer.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    setScale(previous => (Math.abs(Math.log(s / previous)) > 0.14 ? s : previous));
  }, []);
  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => apply());
  }, [apply]);
  const settle = useCallback(() => setScale(view.current.s), []);

  // At least a quarter of the plan stays in view.
  const clamp = useCallback((v: View): View => {
    const el = viewportRef.current;
    const { W: w, H: h } = live.current;
    if (!el || !w || !h) return v;
    const vw = el.clientWidth, vh = el.clientHeight, pw = w * v.s, ph = h * v.s;
    const mx = Math.min(pw, vw) * 0.25, my = Math.min(ph, vh) * 0.25;
    return { s: v.s, x: Math.min(vw - mx, Math.max(mx - pw, v.x)), y: Math.min(vh - my, Math.max(my - ph, v.y)) };
  }, []);

  const measureFit = useCallback(() => {
    const el = viewportRef.current;
    const { W: w, H: h } = live.current;
    if (!el || !w || !h || !el.clientWidth || !el.clientHeight) return null;
    return Math.min(el.clientWidth / w, el.clientHeight / h);
  }, []);
  const fit = useCallback((animate = false) => {
    const el = viewportRef.current;
    const s = measureFit();
    if (!el || !s) return;
    const { W: w, H: h } = live.current;
    fitScale.current = s;
    atFit.current = true;
    view.current = { s, x: (el.clientWidth - w * s) / 2, y: (el.clientHeight - h * s) / 2 };
    apply(animate);
    setScale(s);
    setReady(true);
  }, [apply, measureFit]);

  const zoomAt = useCallback((cx: number, cy: number, factor: number, animate = false) => {
    const v = view.current;
    const s = Math.min(fitScale.current * MAX_ZOOM, Math.max(fitScale.current, v.s * factor));
    if (!Number.isFinite(s) || s === v.s) return;
    if (s <= fitScale.current * 1.001) { fit(animate); return; }
    atFit.current = false;
    view.current = clamp({ s, x: cx - (cx - v.x) * (s / v.s), y: cy - (cy - v.y) * (s / v.s) });
    if (animate) { apply(true); settle(); } else schedule();
  }, [apply, clamp, fit, schedule, settle]);
  const zoomCentre = (factor: number) => {
    const el = viewportRef.current;
    if (el) zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor, true);
  };

  // Fit when the plan or its size is first known, and stay fitted through
  // resizes until the person zooms or pans.
  useLayoutEffect(() => { setReady(false); atFit.current = true; }, [planId]);
  useLayoutEffect(() => { if (W && H) fit(); }, [W, H, planId, fit]);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (atFit.current) { fit(); return; }
      const s = measureFit();
      if (!s) return;
      if (s >= view.current.s) { fit(); return; }
      fitScale.current = s;
      view.current = clamp({ ...view.current, s: Math.min(s * MAX_ZOOM, view.current.s) });
      apply();
      settle();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [apply, clamp, fit, measureFit, settle]);

  // React's wheel listener is passive, so the page would scroll under the plan.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element | null)?.closest?.("[data-canvas-control]")) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const step = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-step * (event.ctrlKey ? 0.01 : 0.0018)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const geometry = useMemo(() => {
    const map = new Map<string, Geometry>();
    if (W && H) for (const shape of shapes) { const g = shapeGeometry(shape.polygon, W, H); if (g) map.set(shape.id, g); }
    return map;
  }, [shapes, W, H]);

  // Bring a shape into view when the host asks for it, once it is on the plan.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId) { focused.current = null; return; }
    const el = viewportRef.current, g = geometry.get(focusId);
    const request = `${focusKey}:${focusId}`;
    if (focused.current === request || !ready || !el || !g) return;
    focused.current = request;
    const { x0, y0 } = g, x1 = g.x0 + g.w, y1 = g.y0 + g.h;
    const v = view.current, vw = el.clientWidth, vh = el.clientHeight, pad = 24;
    const onScreen = Math.max((x1 - x0) * v.s, (y1 - y0) * v.s);
    const inView = v.x + x0 * v.s >= pad && v.y + y0 * v.s >= pad && v.x + x1 * v.s <= vw - pad && v.y + y1 * v.s <= vh - pad;
    if (inView && onScreen >= 60) return;
    // Close enough to read the unit, never so close that its neighbours are lost.
    const wanted = Math.min(fitScale.current * 4, (0.35 * Math.min(vw, vh)) / Math.max(x1 - x0, y1 - y0, 1));
    const fits = (x1 - x0) * v.s <= vw - pad * 2 && (y1 - y0) * v.s <= vh - pad * 2;
    const s = Math.min(fitScale.current * MAX_ZOOM, Math.max(fitScale.current, onScreen >= 60 && fits ? v.s : wanted));
    atFit.current = false;
    view.current = clamp({ s, x: vw / 2 - ((x0 + x1) / 2) * s, y: vh / 2 - ((y0 + y1) / 2) * s });
    apply(true);
    settle();
  }, [focusId, focusKey, geometry, ready, apply, clamp, settle]);

  // Pointers: one drags, two pinch. A press that barely moves is a click.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; cx: number; cy: number } | null>(null);
  const local = (event: { clientX: number; clientY: number }) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const click = (event: ReactPointerEvent) => {
    const { pick: picking, W: w, H: h, onSelect: select } = live.current;
    if (picking) {
      if (picking.busy || !w || !h) return;
      const p = local(event), v = view.current;
      const x = (p.x - v.x) / v.s / w, y = (p.y - v.y) / v.s / h;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) picking.onPick({ x, y });
      return;
    }
    const id = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-shape-id]")?.getAttribute("data-shape-id");
    if (id) select(id);
  };
  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as Element).closest?.("[data-canvas-control]")) return;
    try { viewportRef.current?.setPointerCapture(event.pointerId); } catch { /* the pointer has already gone */ }
    const p = local(event);
    pointers.current.set(event.pointerId, p);
    if (pointers.current.size === 1) {
      drag.current = { id: event.pointerId, sx: p.x, sy: p.y, vx: view.current.x, vy: view.current.y, moved: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      if (drag.current) drag.current.moved = true;
    }
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    const p = local(event);
    pointers.current.set(event.pointerId, p);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const v = view.current;
      const s = Math.min(fitScale.current * MAX_ZOOM, Math.max(fitScale.current, v.s * (d / pinch.current.d)));
      const px = v.x + (cx - pinch.current.cx), py = v.y + (cy - pinch.current.cy);
      atFit.current = false;
      view.current = clamp({ s, x: cx - (cx - px) * (s / v.s), y: cy - (cy - py) * (s / v.s) });
      pinch.current = { d, cx, cy };
      schedule();
      return;
    }
    const g = drag.current;
    if (!g || g.id !== event.pointerId) return;
    const dx = p.x - g.sx, dy = p.y - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    g.moved = true;
    atFit.current = false;
    view.current = clamp({ s: view.current.s, x: g.vx + dx, y: g.vy + dy });
    schedule();
  };
  const onPointerEnd = (event: ReactPointerEvent) => {
    if (!pointers.current.delete(event.pointerId)) return;
    try { viewportRef.current?.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (pointers.current.size < 2) pinch.current = null;
    else {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
    const g = drag.current;
    if (g && g.id === event.pointerId) {
      drag.current = null;
      if (!g.moved && event.type === "pointerup") click(event);
      else settle();
    }
    // One finger left after a pinch carries on as a drag, never as a click.
    if (pointers.current.size === 1) {
      const [[id, p]] = [...pointers.current.entries()];
      drag.current = { id, sx: p.x, sy: p.y, vx: view.current.x, vy: view.current.y, moved: true };
    }
  };

  const onEnter = useCallback((id: string) => { setOwnHover(id); live.current.onHover?.(id); }, []);
  const onLeave = useCallback(() => { setOwnHover(null); live.current.onHover?.(null); }, []);
  // Tabbing to an outline off screen pans to it at the same zoom.
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const onFocusShape = useCallback((id: string, element: Element) => {
    const el = viewportRef.current, g = geometryRef.current.get(id);
    if (!el || !g || !element.matches?.(":focus-visible")) return;
    const v = view.current, vw = el.clientWidth, vh = el.clientHeight;
    const inView = v.x + g.x0 * v.s >= 0 && v.y + g.y0 * v.s >= 0 && v.x + (g.x0 + g.w) * v.s <= vw && v.y + (g.y0 + g.h) * v.s <= vh;
    if (inView) return;
    atFit.current = false;
    view.current = clamp({ s: v.s, x: vw / 2 - (g.x0 + g.w / 2) * v.s, y: vh / 2 - (g.y0 + g.h / 2) * v.s });
    apply(true);
  }, [apply, clamp]);
  const onKey = useCallback((id: string, key: string) => {
    if (key !== "Enter" && key !== " ") return false;
    if (!live.current.pick) live.current.onSelect(id);
    return true;
  }, []);

  const hovered = ownHover ?? hoverId;
  const hoverShape = hovered && hovered !== selectedId ? shapes.find(s => s.id === hovered) : undefined;
  const selectedShape = selectedId ? shapes.find(s => s.id === selectedId) : undefined;
  const previewPoints = useMemo(() => (preview && W && H ? shapeGeometry(preview, W, H)?.points || null : null), [preview, W, H]);

  return (
    <div
      ref={viewportRef}
      className={cn("relative overflow-hidden rounded-lg border border-border bg-muted/20 select-none", pick ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing", className || "h-[60vh] min-h-[320px]")}
      style={{ touchAction: "none" }}
      data-testid="plan-canvas"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onLostPointerCapture={event => { if (event.target === event.currentTarget) onPointerEnd(event); }}
      onScroll={event => { event.currentTarget.scrollLeft = 0; event.currentTarget.scrollTop = 0; }}
    >
      {image.isError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-sm" data-canvas-control>
          <p>The plan image could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => image.refetch()}>Try again</Button>
        </div>
      ) : !image.src && <Skeleton className="absolute inset-0 rounded-none" />}

      <div ref={layerRef} className="absolute left-0 top-0 origin-top-left will-change-transform" style={{ width: W || 1, height: H || 1, opacity: ready ? 1 : 0 }}>
        {image.src && (
          <img
            src={image.src} alt={`${floor} plan`} draggable={false} className="block h-full w-full pointer-events-none"
            onLoad={event => setNatural({ planId, w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
          />
        )}
        {W > 0 && H > 0 && (
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="absolute inset-0 text-foreground" aria-label={`Units drawn on the ${floor} plan`}>
            <Outlines shapes={shapes} geometry={geometry} scale={scale} onEnter={onEnter} onLeave={onLeave} onKey={onKey} onFocusShape={onFocusShape} />
            {hoverShape && geometry.get(hoverShape.id) && (
              <polygon points={geometry.get(hoverShape.id)!.points} pointerEvents="none" fill={hoverShape.fill || hoverShape.stroke} fillOpacity={0.25} stroke={hoverShape.stroke} strokeWidth={2.5 / scale} strokeLinejoin="round" />
            )}
            {selectedShape && geometry.get(selectedShape.id) && (
              <polygon points={geometry.get(selectedShape.id)!.points} pointerEvents="none" fill={selectedShape.fill || selectedShape.stroke} fillOpacity={0.35} stroke="currentColor" strokeWidth={3 / scale} strokeLinejoin="round" data-testid="plan-shape-selected" />
            )}
            <Labels shapes={shapes} geometry={geometry} scale={scale} />
            {previewPoints && (
              <polygon points={previewPoints} pointerEvents="none" fill={PROPOSAL_HEX} fillOpacity={0.3} stroke={PROPOSAL_HEX} strokeWidth={3 / scale} strokeDasharray={`${8 / scale} ${5 / scale}`} strokeLinejoin="round" className="animate-pulse" data-testid="plan-preview" />
            )}
          </svg>
        )}
      </div>

      <div className="absolute left-2 top-2 flex gap-1" data-canvas-control>
        <Button variant="outline" size="icon" className="h-7 w-7 bg-background" aria-label="Zoom out" onClick={() => zoomCentre(1 / 1.5)}><Minus className="h-3.5 w-3.5" /></Button>
        <Button variant="outline" size="icon" className="h-7 w-7 bg-background" aria-label="Zoom in" onClick={() => zoomCentre(1.5)}><Plus className="h-3.5 w-3.5" /></Button>
        <Button variant="outline" size="icon" className="h-7 w-7 bg-background" aria-label="Fit the plan to the window" onClick={() => fit(true)}><Maximize className="h-3.5 w-3.5" /></Button>
      </div>
      {toolbar && <div className="absolute right-2 top-2 flex gap-1" data-canvas-control>{toolbar}</div>}
      {pick && (
        <div className="pointer-events-none absolute left-1/2 top-11 flex max-w-[70%] -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium shadow-sm" role="status" data-testid="plan-pick-hint">
          {pick.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span className="truncate">{pick.busy ? "Finding the walls" : pick.hint}</span>
        </div>
      )}
      <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/80 px-1.5 py-0.5 text-[11px] text-muted-foreground">{floor}</span>
    </div>
  );
}
