import { Hero } from "../components/Wire";
import { cardUrlFor, type Person } from "../lib/content";
import { useSiteContent } from "../lib/site-content";
import { useTeamPhoto } from "../lib/team-photos";

// Built to wireframe slide 49 (Woody, 2026-10-16, "everything" to the
// wireframes): the group photo with the about blurb over it, then "A-Z
// contact details" as a grid of black and white headshots five across with
// name, title, phone, email and LinkedIn. This replaces the grouped list of
// 2026-10-12; that version is in git history if it is wanted back.
function Tile({ person }: { person: Person }) {
  const photo = useTeamPhoto(person);
  return (
    <div className="w-full">
      {photo ? (
        <img src={photo} alt={person.name} className="aspect-[3/4] w-full object-cover grayscale" />
      ) : (
        <div className="aspect-[3/4] w-full bg-bgp-stone/30 flex items-center justify-center">
          <span className="italic text-sm text-bgp-stone">Headshot to follow</span>
        </div>
      )}
      <p className="mt-3 label-caps font-bold text-bgp-ink">
        <a href={cardUrlFor(person.name)} className="hover:text-bgp-wine" title="Business card">{person.name}</a>
      </p>
      <div className="mt-1 text-sm text-bgp-ink space-y-0.5">
        <p>{person.title}</p>
        <p className="tabular">{person.phone}</p>
        {person.email !== "TBC" && (
          <p className="whitespace-nowrap overflow-hidden text-ellipsis">
            <a href={`mailto:${person.email}`} className="hover:text-bgp-wine">{person.email}</a>
          </p>
        )}
        <p className="italic text-bgp-stone">LinkedIn</p>
      </div>
    </div>
  );
}

export default function Team() {
  const { team } = useSiteContent();
  const surname = (n: string) => n.split(" ").slice(-1)[0];
  const people = [...team].sort((a, b) => surname(a.name).localeCompare(surname(b.name)) || a.name.localeCompare(b.name));

  return (
    <div>
      <Hero
        src="/images/office.jpg"
        alt="The BGP team"
        label="The BGP team"
        statement="Connecting leading brands with the best international locations. Creating neighbourhoods that people love."
        tall
      />
      <h1 className="sr-only">The BGP team</h1>

      <section className="mx-auto max-w-[1360px] px-4 py-7 md:py-8">
        <h2 className="text-2xl font-bold text-bgp-ink border-b-[3px] border-bgp-ink pb-2 mb-6">A-Z contact details</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-5 gap-y-10">
          {people.map((p) => <Tile key={p.name} person={p} />)}
        </div>
      </section>
    </div>
  );
}
