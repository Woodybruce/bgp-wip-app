import { Fragment, useEffect, useState } from "react";
import { cardUrlFor, type Person } from "../lib/content";
import { useTeamPhoto } from "../lib/team-photos";

export default function ContactCard({ person }: { person: Person; compact?: boolean }) {
  const photo = useTeamPhoto(person);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo]);
  const phoneHref = person.phone.replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
  const emailBreak = person.email.indexOf("@") + 1;
  const emailNameParts = person.email.slice(0, emailBreak).split(/(?=[._+-])/);
  const emailDomain = person.email.slice(emailBreak);
  // Optional breaks at the brand's name boundaries keep the complete address
  // readable in narrow cards without splitting arbitrary words or characters.
  const domainParts = emailDomain.toLowerCase() === "brucegillinghampollard.com"
    ? [emailDomain.slice(0, 5), emailDomain.slice(5, 15), emailDomain.slice(15)]
    : emailDomain.split(/(?=[.-])/);

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
      <h3 className="mt-4 text-[clamp(16px,1.46vw,21px)] font-bold uppercase leading-[1.1] text-bgp-ink">
        <a href={cardUrlFor(person.name)} className="hover:text-bgp-wine">{person.name}</a>
      </h3>
      <div className="text-[clamp(16px,1.46vw,21px)] leading-[1.1] text-bgp-ink">
        {person.title && <p>{person.title}</p>}
        {person.phone && <p><a href={`tel:${phoneHref}`} className="tabular hover:text-bgp-wine">{person.phone}</a></p>}
        {person.email && person.email !== "TBC" && (
          <p>
            <a href={`mailto:${person.email}`} className="hover:text-bgp-wine">
              {emailNameParts.map((part, index) => <Fragment key={index}>{index > 0 && <wbr />}{part}</Fragment>)}<wbr />{domainParts.map((part, index) => <Fragment key={index}>{index > 0 && <wbr />}{part}</Fragment>)}
            </a>
          </p>
        )}
        <p className="mt-1 text-[clamp(14px,1.25vw,18px)] italic text-bgp-wine/75">LinkedIn profile to follow</p>
      </div>
    </div>
  );
}
