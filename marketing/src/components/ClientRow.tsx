import { useEffect, useId, useState } from "react";
import type { Client } from "../lib/content";

// Use the supplied logo, or the actual client name when no logo is available.
export function ClientCircle({ client }: { client: Client }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [client.domain]);
  const src = client.domain ? `/brand-logos/${client.domain}.png` : undefined;
  return (
    <div className="flex aspect-square w-full max-w-[128px] items-center justify-center overflow-hidden rounded-full border border-bgp-line bg-white" title={client.name}>
      {src && !failed ? (
        <img src={src} alt={`${client.name} logo`} loading="lazy" className="h-[72%] w-[72%] object-contain" onError={() => setFailed(true)} />
      ) : (
        <span className="px-3 text-center text-[14px] leading-[1.2] text-bgp-wine [overflow-wrap:anywhere]">{client.name}</span>
      )}
    </div>
  );
}

export default function ClientRow({ clients, initialCount = 14, minimumSlots = 14 }: { clients: Client[]; initialCount?: number; minimumSlots?: number }) {
  const [expanded, setExpanded] = useState(false);
  const gridId = useId();
  const visibleClients = expanded ? clients : clients.slice(0, initialCount);
  const placeholderCount = Math.max(0, minimumSlots - visibleClients.length);

  return (
    <div>
      <div id={gridId} className="client-logo-grid grid grid-cols-3 justify-items-center gap-5 sm:grid-cols-4 lg:grid-cols-7 lg:gap-y-6">
        {visibleClients.map((client) => <ClientCircle key={client.name} client={client} />)}
        {Array.from({ length: placeholderCount }, (_, index) => (
          <div
            key={`placeholder-${index}`}
            role="img"
            aria-label="Client logo to follow"
            className="flex aspect-square w-full max-w-[128px] items-center justify-center rounded-full border border-dashed border-bgp-stone bg-bgp-stone/10"
          >
            <span className="px-3 text-center text-xs italic leading-[1.2] text-bgp-wine">Logo to follow</span>
          </div>
        ))}
      </div>
      {clients.length > initialCount && (
        <button type="button" aria-expanded={expanded} aria-controls={gridId} onClick={() => setExpanded((current) => !current)} className="mt-6 min-h-11 text-sm font-medium text-bgp-wine underline underline-offset-4">
          {expanded ? "Show fewer clients" : `Show all clients (${clients.length})`}
        </button>
      )}
    </div>
  );
}
