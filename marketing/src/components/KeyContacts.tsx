import ContactCard from "./ContactCard";
import { Band } from "./Wire";
import type { Person } from "../lib/content";

// Wireframe: a grey band, "Key contacts" with the blurb at left, a row of
// compact portrait tiles at right.
export default function KeyContacts({ people, blurb = "Our team would be delighted to hear from you." }: { people: Person[]; blurb?: string }) {
  if (!people.length) return null;
  return (
    <Band>
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-8 md:gap-12">
        <div>
          <h2 className="display text-2xl md:text-3xl">Key contacts</h2>
          <p className="mt-4 text-base text-bgp-ink/80">{blurb}</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
          {people.map((p) => (
            <ContactCard key={p.name} person={p} compact />
          ))}
        </div>
      </div>
    </Band>
  );
}
