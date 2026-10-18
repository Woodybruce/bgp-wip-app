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

export default function ClientRow({ clients }: { clients: Client[]; padTo?: number }) {
  return (
    <div className="grid grid-cols-3 justify-items-center gap-5 sm:grid-cols-4 lg:grid-cols-7 lg:gap-x-7 lg:gap-y-8">
      {clients.map((client) => <ClientCircle key={client.name} client={client} />)}
    </div>
  );
}
