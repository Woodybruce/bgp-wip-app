import { useState } from "react";
import type { Client } from "../lib/content";
import { logoKitEnabled, logoKitUrl } from "../lib/logokit";

// "A snapshot of clients" — LogoKit first (when a key is configured), then the
// self-hosted PNGs in public/brand-logos/, then the client name.
function ClientCircle({ client }: { client: Client }) {
  const [failed, setFailed] = useState(0);
  const sources: string[] = [];
  if (client.domain) {
    if (logoKitEnabled) sources.push(logoKitUrl(client.domain));
    sources.push(`/brand-logos/${client.domain}.png`);
  }
  const src = sources[failed];

  return (
    <div
      className="aspect-square rounded-full border border-bgp-line bg-white flex items-center justify-center overflow-hidden p-5"
      title={client.name}
    >
      {src ? (
        <img
          src={src}
          alt={`${client.name} logo`}
          loading="lazy"
          className="max-h-full max-w-full object-contain"
          onError={() => setFailed((f) => f + 1)}
        />
      ) : (
        <span className="text-center text-[10px] font-semibold uppercase tracking-widest text-bgp-ink/60">
          {client.name}
        </span>
      )}
    </div>
  );
}

export default function ClientRow({ clients }: { clients: Client[] }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-6">
      {clients.map((c) => (
        <ClientCircle key={c.name} client={c} />
      ))}
    </div>
  );
}
