import { useRef, useEffect, useState, type ReactNode } from "react";

interface ScrollableTableProps {
  children: ReactNode;
  minWidth: number;
  // Scroll with the page instead of inside a fixed-height box: no internal
  // vertical scrollbar, the table takes its natural height. Horizontal
  // scrolling and the sticky bottom scrollbar are kept.
  pageScroll?: boolean;
}

export function ScrollableTable({ children, minWidth, pageScroll = false }: ScrollableTableProps) {
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef<"bottom" | "table" | null>(null);
  const [contentWidth, setContentWidth] = useState(minWidth);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

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

  // Height the scroll box to whatever room is actually left below it. The CSS
  // fallback assumes 200px of page furniture above the table; pages that stack
  // a title + count cards + a search bar + a section header run to ~325px, so
  // the box overshot the viewport and its last rows (and the synced bottom
  // scrollbar) sat below the fold, unreachable. Measure instead of guess.
  useEffect(() => {
    if (pageScroll) return;
    const el = tableScrollRef.current;
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top;
      // Leave room for the sync bar underneath plus a little breathing space.
      const avail = window.innerHeight - top - 24;
      setMaxHeight(Math.max(240, Math.round(avail)));
    };
    update();
    window.addEventListener("resize", update);
    // The furniture above can change height (filter chips wrapping, cards
    // loading in), which moves our top edge without firing a window resize.
    const ro = new ResizeObserver(update);
    if (el.parentElement) ro.observe(el.parentElement);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [pageScroll]);

  return (
    <div className={pageScroll ? "flex flex-col" : "flex flex-col flex-1 min-h-0"}>
      <div
        ref={tableScrollRef}
        className={pageScroll ? "table-scroll-container" : "table-scroll-container flex-1 min-h-0"}
        style={pageScroll ? { maxHeight: "none", overflowY: "visible" } : maxHeight ? { maxHeight } : undefined}
      >
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
