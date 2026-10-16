import ContactCard from "../components/ContactCard";
import { Hero, SectionHead } from "../components/Wire";
import type { Person } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

// Team per wireframe slide 49: full-width photo with the about line over
// it, then "A–Z contact details" as a grid of headshots with name, title,
// phone and email. Alphabetical by surname. Names, titles, phones and
// photos come from HR in the dashboard (CLAUDE.md, 2026-10-13).
const surname = (n: string) => n.split(" ").slice(-1)[0];

export default function Team() {
  const { team } = useSiteContent();
  const people: Person[] = [...team].sort((a, b) => surname(a.name).localeCompare(surname(b.name)) || a.name.localeCompare(b.name));

  return (
    <div>
      <Hero
        src="/images/office.jpg"
        alt="The BGP office"
        label="The BGP team"
        statement="Connecting leading brands with the best international locations. Creating neighbourhoods that people love."
      />

      <section className="mx-auto max-w-6xl px-4 py-12 md:py-14">
        <SectionHead as="h1" title="A–Z contact details" sub={`${people.length} people across Leasing, Investment, Brand Representation, Lease Advisory and Consultancy`} />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-6 gap-y-10">
          {people.map((p) => (
            <ContactCard key={p.name} person={p} />
          ))}
        </div>
      </section>
    </div>
  );
}
