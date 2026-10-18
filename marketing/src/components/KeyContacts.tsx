import ContactCard from "./ContactCard";
import type { Person } from "../lib/content";

function ContactPlaceholder() {
  return (
    <div className="min-w-0 w-full" aria-label="Placeholder contact, details to follow">
      <div className="relative aspect-[3/4] overflow-hidden bg-bgp-stone/20">
        <img src="/images/placeholders/portrait.svg" alt="Placeholder portrait" loading="lazy" className="h-full w-full object-cover grayscale" />
        <span className="absolute inset-x-2 bottom-2 bg-bgp-cream/95 px-2 py-1 text-center text-xs italic text-bgp-wine">Contact to follow</span>
      </div>
      <p className="mt-4 text-sm font-bold uppercase">Team contact to follow</p>
      <p className="mt-2 text-sm italic leading-snug">Name, role and contact details to follow.</p>
    </div>
  );
}

export default function KeyContacts({ people, blurb = "Our team would be delighted to hear from you.", band = true, layout = "beside", minimumSlots, padTo }: { people: Person[]; blurb?: string; band?: boolean; layout?: "beside" | "row"; minimumSlots?: number; padTo?: number }) {
  const missing = Math.max(0, (minimumSlots ?? padTo ?? (layout === "row" ? 5 : 3)) - people.length);
  const cards = <>{people.map((person) => <ContactCard key={person.name} person={person} compact />)}{Array.from({ length: missing }, (_, index) => <ContactPlaceholder key={`contact-placeholder-${index}`} />)}</>;
  return (
    <section className={band ? "bg-bgp-mist" : ""}>
      <div className="site-container section-space">
        {layout === "row" ? (
          <>
            <h2 className="section-title mb-8">Key contacts</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-8">
              {cards}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[2fr_3fr] lg:gap-16">
            <div>
              <h2 className="section-title">Key contacts</h2>
              <p className="body-copy mt-5 max-w-md">{blurb}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 sm:gap-x-7">
              {cards}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
