import { useRef, useEffect, type ReactNode } from "react";

interface ScrollableTableProps {
  children: ReactNode;
  minWidth: number;
}

export function ScrollableTable({ children, minWidth }: ScrollableTableProps) {
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef<"bottom" | "table" | null>(null);

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

  return (
    <div className="flex flex-col">
      <div ref={tableScrollRef} className="table-scroll-container">
        <div style={{ minWidth }}>
          {children}
        </div>
      </div>
      <div ref={bottomScrollRef} className="sync-scroll-bottom">
        <div style={{ width: minWidth, height: 1 }} />
      </div>
    </div>
  );
}
