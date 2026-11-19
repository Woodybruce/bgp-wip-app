// Two columns of cards, with one card that goes under whichever column is
// shorter, so the columns end together (Woody, 2026-11-18, on the Expansion
// tab: "can you fix this gap?"). The Competitor set used to sit under the
// score card on the guess that Signals would be the long card; a brand with
// a long score card and few signals left a block of empty page beside it.
// The columns are measured without the moving card, so moving it never
// changes the measurement. On one column (a narrow page) it keeps its place
// in the reading order, under the first column.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function BalancedPair({ left, right, floater, pairClass, stackClass, testId, rightTestId }: {
  left: ReactNode;
  right: ReactNode;
  floater: ReactNode | null;
  pairClass: string;
  stackClass: string;
  testId?: string;
  rightTestId?: string;
}) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"left" | "right">("left");
  useLayoutEffect(() => {
    const l = leftRef.current, r = rightRef.current;
    if (!l || !r || !floater) return;
    const decide = () => {
      const sideBySide = Math.abs(l.getBoundingClientRect().top - r.getBoundingClientRect().top) < 4;
      const next = sideBySide && r.offsetHeight < l.offsetHeight ? "right" : "left";
      setSide(current => current === next ? current : next);
    };
    decide();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(decide);
    watch.observe(l);
    watch.observe(r);
    return () => watch.disconnect();
  }, [!!floater]);
  return (
    <div className={pairClass} data-testid={testId} data-floater-side={floater ? side : undefined}>
      <div className={stackClass}>
        <div ref={leftRef} className={stackClass}>{left}</div>
        {side === "left" && floater}
      </div>
      <div className={stackClass} data-testid={rightTestId}>
        <div ref={rightRef} className={stackClass}>{right}</div>
        {side === "right" && floater}
      </div>
    </div>
  );
}
