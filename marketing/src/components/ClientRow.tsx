import { useEffect, useRef, useState } from "react";
import type { Client } from "../lib/content";
import { LOGOKIT_TOKEN, logoKitEnabled } from "../lib/logokit";

// "A snapshot of clients" — LogoKit (fallback=404 so misses fail honestly),
// then self-hosted PNGs in public/brand-logos/, then the client name.
// A load timeout skips any source that hangs (ad-blockers, firewalls).
// Grayscale unifies mixed logo colours; hover restores each brand's own.
function ClientCircle({ client }: { client: Client }) {
  const [step, setStep] = useState(0);
  const loadedRef = useRef(false);

  const sources: string[] = [];
  if (client.domain) {
    if (logoKitEnabled) {
      sources.push(`https://img.logokit.com/${client.domain}?token=${LOGOKIT_TOKEN}&size=128&fallback=404`);
    }
    sources.push(`/brand-logos/${client.domain}.png`);
  }
  const src = sources[step];

  useEffect(() => {
    if (!src) return;
    loadedRef.current = false;
    const timer = setTimeout(() => {
      if (!loadedRef.current) setStep((s) => s + 1);
    }, 2500);
    return () => clearTimeout(timer);
  }, [src]);

  return (
    <div
      className="group aspect-square rounded-full border border-bgp-line bg-white flex items-center justify-center overflow-hidden hover:border-bgp-burgundy/40 transition-colors"
      title={client.name}
    >
      {src ? (
        <img
          src={src}
          alt={`${client.name} logo`}
          loading="lazy"
          className="h-3/5 w-3/5 object-contain grayscale opacity-70 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-200"
          onLoad={() => { loadedRef.current = true; }}
          onError={() => setStep((s) => s + 1)}
        />
      ) : (
        <span className="px-3 text-center text-[10px] font-semibold uppercase tracking-widest text-bgp-ink/60">
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
