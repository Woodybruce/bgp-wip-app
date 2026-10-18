import { useEffect, useRef, type ReactNode } from "react";

/** Keep the design's headline size unless an intact word exceeds its column. */
export default function FittedHeading({ as: Tag = "h2", className = "", children }: {
  as?: "h1" | "h2" | "h3";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const heading = ref.current;
    if (!heading) return;
    let active = true;
    let lastWidth = -1;
    const fit = () => {
      if (!active) return;
      heading.style.removeProperty("font-size");
      const style = getComputedStyle(heading);
      const width = heading.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (width <= 0) return;
      const baseSize = parseFloat(style.fontSize);
      const measure = document.createElement("span");
      Object.assign(measure.style, {
        position: "fixed", visibility: "hidden", whiteSpace: "nowrap",
        font: style.font, letterSpacing: style.letterSpacing,
        textTransform: style.textTransform, pointerEvents: "none",
      });
      measure.setAttribute("aria-hidden", "true");
      document.body.appendChild(measure);
      let longest = 0;
      for (const word of (heading.textContent || "").trim().split(/\s+/)) {
        measure.textContent = word;
        longest = Math.max(longest, measure.getBoundingClientRect().width);
      }
      measure.remove();
      if (longest > width) {
        heading.style.fontSize = `${Math.floor(baseSize * (width - 2) / longest * 10) / 10}px`;
      }
    };
    fit();
    void document.fonts.ready.then(fit);
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width !== lastWidth) {
        lastWidth = entry.contentRect.width;
        fit();
      }
    });
    observer.observe(heading);
    window.addEventListener("resize", fit);
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [children]);

  return <Tag ref={ref} className={`fitted-heading ${className}`}>{children}</Tag>;
}
