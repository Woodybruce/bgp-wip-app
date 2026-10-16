import ContactCard from "./ContactCard";
import { Band } from "./Wire";
import type { Person } from "../lib/content";

// Key contacts as the slides draw them. Slides 38 and 41: grey band, heading
// and blurb at left, tiles at right. Slides 26, 27, 28, 31, 32: on white under
// a rule; 26 and 31 put the heading above a full row of tiles.
export default function KeyContacts({ people, blurb = "Our team would be delighted to hear from you.", band = true, layout = "beside" }: { people: Person[]; blurb?: string; band?: boolean; layout?: "beside" | "row" }) {
  if (!people.length) return null;
  const inner = layout === "row" ? (
    <div>
      <h2 className="text-sm font-bold text-bgp-ink mb-5">Key contacts</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
        {people.map((p) => (
          <ContactCard key={p.name} person={p} compact />
        ))}
      </div>
    </div>
  ) : (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-8 md:gap-12">
      <div>
        <h2 className="text-sm font-bold text-bgp-ink">Key contacts</h2>
        <p className="mt-3 text-base text-bgp-ink/80">{blurb}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
        {people.map((p) => (
          <ContactCard key={p.name} person={p} compact />
        ))}
      </div>
    </div>
  );
  if (band) return <Band>{inner}</Band>;
  return (
    <section className="mx-auto max-w-6xl px-4">
      <div className="border-t border-bgp-ink pt-6 pb-12">{inner}</div>
    </section>
  );
}
