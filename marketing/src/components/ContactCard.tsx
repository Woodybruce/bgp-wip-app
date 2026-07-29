import Placeholder from "./Placeholder";
import type { Person } from "../lib/content";

export default function ContactCard({ person }: { person: Person }) {
  return (
    <div className="w-full">
      <Placeholder label="" className="aspect-[3/4] w-full grayscale" src={person.photo} alt={person.name} />
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
        <p><a href="#" className="underline decoration-bgp-pink-deep underline-offset-2 hover:text-bgp-red">LinkedIn</a></p>
      </div>
    </div>
  );
}
