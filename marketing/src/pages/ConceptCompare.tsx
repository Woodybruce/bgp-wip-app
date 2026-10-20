import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { DESIGN_CONCEPTS } from "../lib/design-concepts";
import "./concept-compare.css";

const VIEWS = [
  { id: "phone", name: "Phone" },
  { id: "desktop", name: "Desktop" },
  { id: "both", name: "Side by side" },
] as const;

function DevicePreview({ device, name, href }: { device: "phone" | "desktop"; name: string; href: string }) {
  const width = device === "phone" ? 390 : 1440;
  const height = device === "phone" ? 844 : 1000;
  const canvas = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);

  return (
    <section className={`device-preview device-preview--${device}`} aria-label={`${name} on ${device}`}>
      <div className="device-preview__label">
        <h2>{device === "phone" ? "Phone" : "Desktop"}</h2>
        <span>{name}</span>
      </div>
      <div className="device-preview__shell">
        <div className="device-preview__canvas" ref={canvas} style={{ maxWidth: width, height: height * scale }}>
          <iframe
            key={href}
            title={`${name} ${device} preview`}
            src={`${href}?preview=embedded`}
            width={width}
            height={height}
            style={{ transform: `scale(${scale})` }}
          />
        </div>
      </div>
    </section>
  );
}

export default function ConceptCompare() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const concept = DESIGN_CONCEPTS.find(item => item.id === params.get("concept")) ?? DESIGN_CONCEPTS[0];
  const view = VIEWS.find(item => item.id === params.get("view"))?.id ?? "phone";
  const update = (conceptId: string, deviceView: string) =>
    navigate(`/concepts/compare?concept=${conceptId}&view=${deviceView}`, { replace: true });

  return (
    <div className="concept-compare">
      <header className="concept-compare__header">
        <div className="concept-compare__intro">
          <div><p>BGP · Design preview</p><h1>One design. Every screen.</h1></div>
          <Link href={concept.href} className="concept-compare__open">Open {concept.name} website</Link>
        </div>
        <div className="concept-compare__controls">
          <div className="concept-compare__choices" role="group" aria-label="Choose a concept">
            {DESIGN_CONCEPTS.map(item => <button key={item.id} type="button" aria-pressed={concept.id === item.id} onClick={() => update(item.id, view)}>{item.name}</button>)}
          </div>
          <div className="concept-compare__choices concept-compare__views" role="group" aria-label="Choose screen comparison">
            {VIEWS.map(item => <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => update(concept.id, item.id)}>{item.name}</button>)}
          </div>
        </div>
        <p className="concept-compare__hint">Scroll, open menus and explore inside each preview.</p>
      </header>
      <div className={`concept-compare__stage concept-compare__stage--${view}`}>
        {view !== "phone" && <DevicePreview device="desktop" name={concept.name} href={concept.href} />}
        {view !== "desktop" && <DevicePreview device="phone" name={concept.name} href={concept.href} />}
      </div>
    </div>
  );
}
