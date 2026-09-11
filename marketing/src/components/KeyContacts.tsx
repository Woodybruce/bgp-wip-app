import ContactCard from "./ContactCard";
import type { Person } from "../lib/content";

export default function KeyContacts({ people, blurb }: { people: Person[]; blurb?: string }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-14">
      <h2 className="display text-3xl md:text-4xl text-bgp-red mb-8">Key contacts</h2>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
        {blurb && (
          <p className="col-span-2 sm:col-span-1 text-[15px] md:text-base font-light text-bgp-ink/85 leading-relaxed">{blurb}</p>
        )}
        {people.map((p) => (
          <ContactCard key={p.name} person={p} />
        ))}
      </div>
    </section>
  );
}
