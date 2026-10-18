import { useEffect, useState } from "react";
import type { Client } from "../lib/content";

// Use the supplied logo, or the actual client name when no logo is available.
export function ClientCircle({ client }: { client: Client }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [client.domain]);
  const src = client.domain ? `/brand-logos/${client.domain}.png` : undefined;
  return (
    <div className="flex aspect-square w-full max-w-[160px] items-center justify-center overflow-hidden rounded-full border border-bgp-line bg-white" title={client.name}>
      {src && !failed ? (
        <img src={src} alt={`${client.name} logo`} loading="lazy" className="h-[72%] w-[72%] object-contain" onError={() => setFailed(true)} />
      ) : (
        <span className="px-3 text-center text-[14px] leading-[1.2] text-bgp-wine [overflow-wrap:anywhere]">{client.name}</span>
      )}
    </div>
  );
}

export default function ClientRow({ clients, fillLastRow = false }: { clients: Client[]; fillLastRow?: boolean }) {
  const remaining = (columns: number) => fillLastRow && clients.length > 0 ? (columns - clients.length % columns) % columns : 0;
  const placeholders = { mobile: remaining(3), tablet: remaining(4), desktop: remaining(7) };

  return (
    <div className="grid grid-cols-3 justify-items-center gap-5 sm:grid-cols-4 lg:grid-cols-7 lg:gap-x-7 lg:gap-y-8">
      {clients.map((client) => <ClientCircle key={client.name} client={client} />)}
      {Array.from({ length: Math.max(placeholders.mobile, placeholders.tablet, placeholders.desktop) }, (_, index) => (
        <div
          key={`placeholder-${index}`}
          role="img"
          aria-label="Client logo to follow"
          className={`aspect-square w-full max-w-[160px] items-center justify-center rounded-full border border-dashed border-bgp-stone bg-bgp-stone/10 ${index < placeholders.mobile ? "flex" : "hidden"} ${index < placeholders.tablet ? "sm:flex" : "sm:hidden"} ${index < placeholders.desktop ? "lg:flex" : "lg:hidden"}`}
        >
          <span className="px-3 text-center text-[14px] italic leading-[1.2] text-bgp-wine">Logo to follow</span>
        </div>
      ))}
    </div>
  );
}
