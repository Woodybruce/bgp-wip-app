import { useState } from "react";
import type { Client } from "../lib/content";

// "A snapshot of clients" — logos via the Clearbit logo API (same source the
// dashboard uses); falls back to the client name if no logo resolves.
function ClientCircle({ client }: { client: Client }) {
  const [failed, setFailed] = useState(false);
  const showLogo = client.domain && !failed;
  return (
    <div
      className="aspect-square rounded-full border border-bgp-line bg-white flex items-center justify-center overflow-hidden p-4"
      title={client.name}
    >
      {showLogo ? (
        <img
          src={`https://logo.clearbit.com/${client.domain}?size=256`}
          alt={`${client.name} logo`}
          loading="lazy"
          className="max-h-full max-w-full object-contain"
          onError={() => setFailed(true)}
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
