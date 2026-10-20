import { Link, useLocation } from "wouter";
import { DESIGN_CONCEPTS } from "../lib/design-concepts";
import "./concept-switcher.css";

export default function ConceptSwitcher() {
  const [location] = useLocation();
  const selected = DESIGN_CONCEPTS.find(concept => concept.href === location) ?? DESIGN_CONCEPTS[0];
  return (
    <aside className="concept-switcher" aria-label="Compare website design concepts">
      <span className="concept-switcher__label">BGP <span>Design preview</span></span>
      <nav aria-label="Design concepts">
        {DESIGN_CONCEPTS.map(concept => (
          <Link
            key={concept.href}
            href={concept.href}
            aria-current={location === concept.href ? "page" : undefined}
          >
            <span>{concept.number}</span>{concept.name}
          </Link>
        ))}
      </nav>
      <Link className="concept-switcher__phone" href={`/concepts/compare?concept=${selected.id}&view=phone`} aria-label="Phone preview"><span>Phone preview</span><span aria-hidden="true">Phone</span></Link>
    </aside>
  );
}
