import { cardUrlFor, type Person } from "../lib/content";
import { useTeamPhoto } from "../lib/team-photos";

// Compact contact tile per the wireframe key-contacts row: small portrait,
// caps name, title, phone, email. Initials on Stone when no headshot exists.
function Monogram({ name }: { name: string }) {
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("");
  return (
    <div className="aspect-[9/10] w-full bg-bgp-stone/40 flex items-center justify-center">
      <span className="font-display font-bold text-3xl text-bgp-wine/60">{initials}</span>
    </div>
  );
}

export default function ContactCard({ person, compact = false }: { person: Person; compact?: boolean }) {
  const photo = useTeamPhoto(person);
  return (
    <div className={`w-full group ${compact ? "max-w-[14rem]" : ""}`}>
      <div className="img-frame">
        {photo ? (
          <img src={photo} alt={person.name} className="aspect-[9/10] w-full object-cover grayscale" />
        ) : (
          <Monogram name={person.name} />
        )}
      </div>
      <p className="label-caps mt-3 text-bgp-wine"><a href={cardUrlFor(person.name)} className="hover:opacity-70" title="Business card">{person.name}</a></p>
      <div className="mt-1 text-sm text-bgp-ink/70 space-y-0.5">
        <p>{person.title}</p>
        <p className="tabular">{person.phone}</p>
        {person.email !== "TBC" && (
          <p className="whitespace-nowrap overflow-hidden text-ellipsis">
            <a href={`mailto:${person.email}`} className="hover:text-bgp-wine">{person.email}</a>
          </p>
        )}
      </div>
    </div>
  );
}
