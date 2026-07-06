import Placeholder from "./Placeholder";
import type { Person } from "../lib/content";

export default function ContactCard({ person }: { person: Person }) {
  return (
    <div className="w-full">
      <Placeholder label="" className="aspect-[3/4] w-full grayscale" />
      <p className="label-caps mt-3">{person.name}</p>
      <div className="mt-1 text-xs leading-relaxed text-bgp-ink/60">
        <p>{person.title}</p>
        <p className="tabular">{person.phone}</p>
        <p className="break-all">
          {person.email === "TBC" ? (
            "Email TBC"
          ) : (
            <a href={`mailto:${person.email}`} className="hover:text-bgp-burgundy">{person.email}</a>
          )}
        </p>
        <p><a href="#" className="underline decoration-bgp-stone underline-offset-2 hover:text-bgp-burgundy">LinkedIn</a></p>
      </div>
    </div>
  );
}
