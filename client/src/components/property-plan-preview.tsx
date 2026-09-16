import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/queryClient";
import type { PlanPolygon, PropertyPlan } from "./property-plan-types";

// Blob URLs let plans work with the app's bearer-token sessions as well as cookies.
export function usePropertyPlanImage(planId: string) {
  const query = useQuery({
    queryKey: ["/api/plans", planId, "image"],
    queryFn: async () => {
      const response = await fetch(`/api/plans/${planId}/image`, { credentials: "include", headers: getAuthHeaders() });
      if (!response.ok) throw new Error("The plan image could not be loaded. Please retry.");
      return response.blob();
    },
    staleTime: Infinity,
    meta: { persist: false },
  });
  const [source, setSource] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!query.data) return;
    if (!(query.data instanceof Blob)) { void query.refetch(); return; }
    const url = URL.createObjectURL(query.data);
    setSource({ blob: query.data, url });
    return () => URL.revokeObjectURL(url);
  }, [query.data]);
  return { ...query, src: source && source.blob === query.data ? source.url : undefined };
}

export function PropertyPlanPreview({ plan, outlines, onSelect }: {
  plan: PropertyPlan;
  outlines: Array<{ id: string; polygon: PlanPolygon; selected?: boolean; accepted?: boolean }>;
  onSelect?: (id: string) => void;
}) {
  const image = usePropertyPlanImage(plan.id);
  const [size, setSize] = useState({ width: plan.width || 1, height: plan.height || 1 });
  const [zoom, setZoom] = useState(1);
  return <div className="space-y-2 min-w-0">
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>Check the outline against the plan before saving.</span>
      <div className="flex gap-1 shrink-0">
        <button type="button" className="border rounded px-2 py-1" aria-label="Zoom out preview" onClick={() => setZoom(z => Math.max(1, z - 0.5))} disabled={zoom === 1}>−</button>
        <button type="button" className="border rounded px-2 py-1" aria-label="Zoom in preview" onClick={() => setZoom(z => Math.min(5, z + 0.5))} disabled={zoom === 5}>+</button>
      </div>
    </div>
    {image.isError ? <p role="alert" className="text-sm text-destructive">{image.error.message} <button type="button" className="underline" onClick={() => image.refetch()}>Retry</button></p> :
      <div className="overflow-auto max-h-[55vh] border rounded bg-muted/20" data-testid="property-plan-outline-preview">
        <div className="relative" style={{ width: `${zoom * 100}%`, aspectRatio: `${size.width} / ${size.height}` }}>
          {image.src && <img src={image.src} alt={`${plan.floor} plan preview`} className="block w-full h-full" onLoad={e => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} />}
          <svg viewBox={`0 0 ${size.width} ${size.height}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-label="Proposed unit outlines">
            {outlines.filter(o => !o.selected).concat(outlines.filter(o => o.selected)).map(outline => <polygon
              key={outline.id}
              points={outline.polygon.points.map(([x, y]) => `${x * size.width},${y * size.height}`).join(" ")}
              fill={outline.selected ? "#6366f1" : outline.accepted ? "#10b981" : "#64748b"}
              fillOpacity={outline.selected ? 0.2 : 0.06}
              stroke={outline.selected ? "#4f46e5" : outline.accepted ? "#059669" : "#64748b"}
              strokeWidth={outline.selected ? 3 : 1.5} vectorEffect="non-scaling-stroke"
              role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined}
              aria-label={onSelect ? `Review outline ${outline.id}` : undefined}
              style={{ cursor: onSelect ? "pointer" : "default" }}
              onClick={() => onSelect?.(outline.id)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(outline.id); } }}
            />)}
          </svg>
        </div>
      </div>}
  </div>;
}
