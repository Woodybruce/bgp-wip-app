import { useRef, useEffect, useState, type ReactNode } from "react";

interface ScrollableTableProps {
  children: ReactNode;
  minWidth: number;
}

export function ScrollableTable({ children, minWidth }: ScrollableTableProps) {
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef<"bottom" | "table" | null>(null);
  const [contentWidth, setContentWidth] = useState(minWidth);

  useEffect(() => {
    const bottomEl = bottomScrollRef.current;
    const tableEl = tableScrollRef.current;
    if (!bottomEl || !tableEl) return;

    const handleBottomScroll = () => {
      if (syncingRef.current === "table") return;
      syncingRef.current = "bottom";
      tableEl.scrollLeft = bottomEl.scrollLeft;
      requestAnimationFrame(() => { syncingRef.current = null; });
    };

    const handleTableScroll = () => {
      if (syncingRef.current === "bottom") return;
      syncingRef.current = "table";
      bottomEl.scrollLeft = tableEl.scrollLeft;
      requestAnimationFrame(() => { syncingRef.current = null; });
    };

    bottomEl.addEventListener("scroll", handleBottomScroll, { passive: true });
    tableEl.addEventListener("scroll", handleTableScroll, { passive: true });
    return () => {
      bottomEl.removeEventListener("scroll", handleBottomScroll);
      tableEl.removeEventListener("scroll", handleTableScroll);
    };
  }, []);

  // Keep the bottom scroll spacer matching the actual rendered content width.
  // Using a hardcoded width breaks when the table is wider than expected — the
  // rightmost columns (often Actions / edit buttons) become unreachable via the
  // bottom scrollbar.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.max(el.scrollWidth, minWidth);
      setContentWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [minWidth]);

  return (
    <div className="flex flex-col">
      <div ref={tableScrollRef} className="table-scroll-container">
        <div ref={innerRef} style={{ minWidth }}>
          {children}
        </div>
      </div>
      <div ref={bottomScrollRef} className="sync-scroll-bottom">
        <div style={{ width: contentWidth, height: 1 }} />
      </div>
    </div>
  );
}
