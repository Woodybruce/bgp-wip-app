import type { Person } from "../lib/content";

// Initials monogram on blush when no headshot exists — an empty grey
// placeholder frame read as unfinished, which undermined the premium feel.
function Monogram({ name }: { name: string }) {
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("");
  return (
    <div className="aspect-[3/4] w-full bg-bgp-pink/50 border border-bgp-pink flex items-center justify-center">
      <span className="font-display text-4xl text-bgp-wine/60">{initials}</span>
    </div>
  );
}

export default function ContactCard({ person }: { person: Person }) {
  return (
    <div className="w-full group">
      <div className="img-frame">
        {person.photo ? (
          <img src={person.photo} alt={person.name} className="aspect-[3/4] w-full object-cover grayscale" />
        ) : (
          <Monogram name={person.name} />
        )}
      </div>
      <p className="label-caps mt-3 text-bgp-red">{person.name}</p>
      <div className="mt-1 text-xs font-light leading-relaxed text-bgp-ink/70">
        <p>{person.title}</p>
        <p className="tabular">{person.phone}</p>
        <p className="break-all">
          {person.email === "TBC" ? (
            "Email TBC"
          ) : (
            <a href={`mailto:${person.email}`} className="hover:text-bgp-red">{person.email}</a>
          )}
        </p>
      </div>
    </div>
  );
}
