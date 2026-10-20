import { Link, useLocation } from "wouter";
import "./concept-switcher.css";

const concepts = [
  { href: "/", number: "01", name: "Clarity" },
  { href: "/concepts/editorial", number: "02", name: "Editorial" },
  { href: "/concepts/pulse", number: "03", name: "Pulse" },
];

export default function ConceptSwitcher() {
  const [location] = useLocation();
  return (
    <aside className="concept-switcher" aria-label="Compare website design concepts">
      <span className="concept-switcher__label">BGP <span>Design preview</span></span>
      <nav aria-label="Design concepts">
        {concepts.map(concept => (
          <Link
            key={concept.href}
            href={concept.href}
            aria-current={location === concept.href ? "page" : undefined}
          >
            <span>{concept.number}</span>{concept.name}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
