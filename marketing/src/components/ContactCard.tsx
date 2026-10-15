import { cardUrlFor, type Person } from "../lib/content";
import { useTeamPhoto } from "../lib/team-photos";

// Initials monogram on blush when no headshot exists — an empty grey
// placeholder frame read as unfinished, which undermined the premium feel.
function Monogram({ name }: { name: string }) {
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("");
  return (
    <div className="aspect-[3/4] w-full bg-bgp-pink/50 border border-bgp-pink flex items-center justify-center">
      <span className="font-display font-bold text-4xl text-bgp-wine/60">{initials}</span>
    </div>
  );
}

export default function ContactCard({ person }: { person: Person }) {
  const photo = useTeamPhoto(person);
  return (
    <div className="w-full group">
      <div className="img-frame">
        {photo ? (
          <img src={photo} alt={person.name} className="aspect-[3/4] w-full object-cover grayscale" />
        ) : (
          <Monogram name={person.name} />
        )}
      </div>
      <p className="label-caps mt-3 text-bgp-wine"><a href={cardUrlFor(person.name)} className="hover:text-bgp-wine" title="Business card">{person.name}</a></p>
      <div className="mt-1 text-sm text-bgp-ink/70">
        <p>{person.title}</p>
        <p className="tabular">{person.phone}</p>
        {person.email !== "TBC" && (
          <p className="text-[13px] whitespace-nowrap overflow-hidden text-ellipsis">
            <a href={`mailto:${person.email}`} className="hover:text-bgp-wine">{person.email}</a>
          </p>
        )}
      </div>
    </div>
  );
}
