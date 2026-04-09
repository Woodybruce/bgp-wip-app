import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor } from "react-grid-layout";
import type { Layout, ResponsiveLayouts, LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { GripVertical, EyeOff } from "lucide-react";

interface GridItem {
  id: string;
  label?: string;
  content: React.ReactNode;
  defaultW?: number;
  defaultH?: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

interface DraggableGridProps {
  items: GridItem[];
  savedLayout?: Record<string, any> | null;
  onLayoutSave?: (layout: Record<string, any>) => void;
  onHideItem?: (id: string) => void;
  editing?: boolean;
  cols?: { lg: number; md: number; sm: number; xs: number };
  rowHeight?: number;
  className?: string;
}

function generateDefaultLayout(items: GridItem[], cols: number): LayoutItem[] {
  const layouts: LayoutItem[] = [];
  const heightMap = new Array(cols).fill(0);

  for (const item of items) {
    const w = Math.min(item.defaultW || cols, cols);
    const h = item.defaultH || 4;

    let bestX = 0;
    let bestY = Infinity;
    for (let x = 0; x <= cols - w; x++) {
      const rowTop = Math.max(...heightMap.slice(x, x + w));
      if (rowTop < bestY) {
        bestY = rowTop;
        bestX = x;
      }
    }

    layouts.push({
      i: item.id,
      x: bestX,
      y: bestY,
      w,
      h,
      minW: item.minW || 1,
      minH: item.minH || 2,
      maxW: item.maxW,
      maxH: item.maxH,
    });

    for (let c = bestX; c < bestX + w; c++) {
      heightMap[c] = bestY + h;
    }
  }
  return layouts;
}

function buildInitialLayouts(
  items: GridItem[],
  savedLayout: Record<string, any> | null | undefined,
  allCols: { lg: number; md: number; sm: number; xs: number },
): ResponsiveLayouts {
  const defaultLayouts: ResponsiveLayouts = {};
  for (const [bp, colCount] of Object.entries(allCols)) {
    defaultLayouts[bp] = generateDefaultLayout(items, colCount);
  }

  if (savedLayout && savedLayout.lg) {
    const savedIds = new Set((savedLayout.lg as LayoutItem[]).map((l: LayoutItem) => l.i));
    const currentIds = new Set(items.map(i => i.id));
    const itemMap = new Map(items.map(i => [i.id, i]));
    const kept = (savedLayout.lg as LayoutItem[])
      .filter((l: LayoutItem) => currentIds.has(l.i))
      .map((l: LayoutItem) => {
        const item = itemMap.get(l.i);
        return {
          ...l,
          minW: item?.minW || l.minW || 1,
          minH: item?.minH || l.minH || 2,
          maxW: item?.maxW || l.maxW,
          maxH: item?.maxH || l.maxH,
        };
      });
    const missing = items.filter(i => !savedIds.has(i.id));
    if (missing.length > 0) {
      const maxY = kept.reduce((max, l) => Math.max(max, l.y + l.h), 0);
      let addY = maxY;
      for (const m of missing) {
        kept.push({
          i: m.id,
          x: 0,
          y: addY,
          w: m.defaultW || allCols.lg,
          h: m.defaultH || 4,
          minW: m.minW || 1,
          minH: m.minH || 2,
        });
        addY += m.defaultH || 4;
      }
    }
    return { ...defaultLayouts, lg: kept };
  }
  return defaultLayouts;
}

export function DraggableGrid({
  items,
  savedLayout,
  onLayoutSave,
  onHideItem,
  editing = false,
  cols = { lg: 12, md: 10, sm: 6, xs: 4 },
  rowHeight = 30,
  className = "",
}: DraggableGridProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width, containerRef } = useContainerWidth();

  const initialLayoutsRef = useRef<ResponsiveLayouts | null>(null);
  const hadSavedRef = useRef(!!savedLayout);
  if (initialLayoutsRef.current === null) {
    initialLayoutsRef.current = buildInitialLayouts(items, savedLayout, cols);
    hadSavedRef.current = !!savedLayout;
  }

  const itemIdsKey = items.map(i => i.id).sort().join(",");
  const prevItemIdsRef = useRef(itemIdsKey);
  const needsRebuild =
    itemIdsKey !== prevItemIdsRef.current ||
    (!hadSavedRef.current && !!savedLayout);
  if (needsRebuild) {
    initialLayoutsRef.current = buildInitialLayouts(items, savedLayout, cols);
    prevItemIdsRef.current = itemIdsKey;
    hadSavedRef.current = !!savedLayout;
  }

  const pendingLayoutRef = useRef<ResponsiveLayouts | null>(null);
  const onLayoutSaveRef = useRef(onLayoutSave);
  onLayoutSaveRef.current = onLayoutSave;
  const computeSignature = (lg: LayoutItem[] | undefined) =>
    lg ? JSON.stringify(lg.map(l => `${l.i}:${l.x},${l.y},${l.w},${l.h}`).sort()) : "";
  const lastSavedLayoutRef = useRef<string>(computeSignature(initialLayoutsRef.current?.lg));

  if (needsRebuild) {
    lastSavedLayoutRef.current = computeSignature(initialLayoutsRef.current?.lg);
  }

  const handleLayoutChange = useCallback((_currentLayout: Layout, allLayouts: ResponsiveLayouts) => {
    if (!editing) return;
    const sig = computeSignature(allLayouts.lg);
    if (sig === lastSavedLayoutRef.current) return;
    pendingLayoutRef.current = allLayouts;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (pendingLayoutRef.current) {
        lastSavedLayoutRef.current = sig;
        onLayoutSaveRef.current?.(pendingLayoutRef.current);
        pendingLayoutRef.current = null;
      }
    }, 2000);
  }, [editing]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (pendingLayoutRef.current) {
        onLayoutSaveRef.current?.(pendingLayoutRef.current);
        pendingLayoutRef.current = null;
      }
    };
  }, []);

  const labelMap = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach(item => { if (item.label) map.set(item.id, item.label); });
    return map;
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {width > 0 && (
        <ResponsiveGridLayout
          className="dashboard-grid"
          width={width}
          layouts={initialLayoutsRef.current!}
          breakpoints={{ lg: 1, md: 0, sm: 0, xs: 0 }}
          cols={cols}
          rowHeight={rowHeight}
          dragConfig={{
            enabled: editing,
            handle: ".grid-drag-handle",
          }}
          resizeConfig={{
            enabled: editing,
            handles: ["se", "e", "s"],
          }}
          onLayoutChange={handleLayoutChange}
          compactor={verticalCompactor}
          margin={[8, 8]}
          containerPadding={[0, 0]}
        >
          {items.map((item) => (
            <div key={item.id} className="grid-item" data-testid={`grid-item-${item.id}`}>
              <div className="h-full relative flex flex-col">
                {editing && (
                  <div className="grid-drag-handle flex-shrink-0 relative z-50 bg-muted/90 border border-border rounded-t-md px-3 py-1 cursor-grab active:cursor-grabbing flex items-center gap-1.5 select-none">
                    <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground font-medium flex-1">{labelMap.get(item.id) || item.id}</span>
                    {onHideItem && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onHideItem(item.id); }}
                        className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Hide this board"
                        data-testid={`button-hide-${item.id}`}
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
                <div className={`flex-1 overflow-hidden ${editing ? "rounded-b-md" : ""}`}>
                  {item.content}
                </div>
              </div>
              {editing && (
                <div className="absolute inset-0 border-2 border-dashed border-primary/30 rounded-lg pointer-events-none" />
              )}
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
