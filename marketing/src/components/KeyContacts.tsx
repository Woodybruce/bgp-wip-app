import ContactCard from "./ContactCard";
import type { Person } from "../lib/content";

export default function KeyContacts({ people, blurb = "Our team would be delighted to hear from you.", band = true, layout = "beside" }: { people: Person[]; blurb?: string; band?: boolean; layout?: "beside" | "row"; padTo?: number }) {
  if (!people.length) return null;
  return (
    <section className={band ? "bg-bgp-mist" : ""}>
      <div className="site-container section-space">
        {layout === "row" ? (
          <>
            <h2 className="section-title mb-8">Key contacts</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-8">
              {people.map((person) => <ContactCard key={person.name} person={person} compact />)}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[2fr_3fr] lg:gap-16">
            <div>
              <h2 className="section-title">Key contacts</h2>
              <p className="body-copy mt-5 max-w-md">{blurb}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 sm:gap-x-7">
              {people.map((person) => <ContactCard key={person.name} person={person} compact />)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
