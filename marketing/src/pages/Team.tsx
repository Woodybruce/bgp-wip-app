import { Hero } from "../components/Wire";
import ContactCard from "../components/ContactCard";
import { useSiteContent } from "../lib/site-content";

export default function Team() {
  const { team } = useSiteContent();
  const surname = (name: string) => name.split(" ").slice(-1)[0];
  const people = [...team].sort((a, b) => surname(a.name).localeCompare(surname(b.name)) || a.name.localeCompare(b.name));

  return (
    <div>
      <Hero
        src="/images/office.jpg"
        alt="Office interior"
        label="The BGP team"
        statement="Connecting leading brands with the best international locations. Creating neighbourhoods that people love."
        tall
      />
      <h1 className="sr-only">The BGP team</h1>
      <section className="site-container section-space">
        <h2 className="section-title mb-10 border-b border-bgp-ink pb-5">A–Z contact details</h2>
        <div className="grid grid-cols-2 gap-x-5 gap-y-12 sm:grid-cols-3 md:gap-x-7 lg:grid-cols-5 lg:gap-x-8">
          {people.map((person) => <ContactCard key={person.name} person={person} />)}
        </div>
      </section>
    </div>
  );
}
