import { useEffect, useState } from "react";
import { cardUrlFor, type Person } from "../lib/content";
import { useTeamPhoto } from "../lib/team-photos";

export default function ContactCard({ person, compact = false }: { person: Person; compact?: boolean }) {
  const photo = useTeamPhoto(person);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo]);
  const phoneHref = person.phone.replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
  const emailBreak = person.email.indexOf("@") + 1;

  return (
    <div className="min-w-0 w-full">
      <a href={cardUrlFor(person.name)} className="block" aria-label={`${person.name}'s business card`}>
        {photo && !failed ? (
          <img src={photo} alt={person.name} loading="lazy" onError={() => setFailed(true)} className="aspect-[3/4] w-full object-cover grayscale" />
        ) : (
          <div className="relative aspect-[3/4] w-full overflow-hidden bg-bgp-stone/30">
            <img src="/images/placeholders/portrait.svg" alt={`${person.name}: portrait to follow`} className="h-full w-full object-cover grayscale" />
            <span className="absolute inset-x-2 bottom-2 bg-bgp-cream/95 px-2 py-1 text-center text-xs italic text-bgp-wine">Portrait to follow</span>
          </div>
        )}
      </a>
      <h3 className="mt-4 text-[14px] font-bold uppercase leading-[1.2] text-bgp-ink">
        <a href={cardUrlFor(person.name)} className="hover:text-bgp-wine">{person.name}</a>
      </h3>
      <div className={`mt-2 space-y-1 leading-[1.4] text-bgp-ink ${compact ? "text-[14px]" : "text-[15px]"}`}>
        {person.title && <p>{person.title}</p>}
        {person.phone && <p><a href={`tel:${phoneHref}`} className="tabular hover:text-bgp-wine">{person.phone}</a></p>}
        {person.email && person.email !== "TBC" && (
          <p className="[overflow-wrap:anywhere]">
            <a href={`mailto:${person.email}`} className="hover:text-bgp-wine">
              {person.email.slice(0, emailBreak)}<wbr />{person.email.slice(emailBreak)}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
