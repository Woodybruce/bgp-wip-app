import { useEffect, useRef, useState } from "react";
import type { Client } from "../lib/content";

// "A snapshot of clients" — LogoKit (fallback=404 so misses fail honestly),
// then self-hosted PNGs in public/brand-logos/, then the client name.
// A load timeout skips any source that hangs (ad-blockers, firewalls).
// Logos show in their own colours (Woody, 2026-10-12).
export function ClientCircle({ client }: { client: Client }) {
  const [step, setStep] = useState(0);
  const loadedRef = useRef(false);

  // Only logos we hold as clean files (public/brand-logos, 640px, from the
  // client's own site). Anything else is typeset — a crisp name beats a
  // favicon or a scraped photo (Woody / Harry, 2026-10-12).
  const sources: string[] = client.domain ? [`/brand-logos/${client.domain}.png`] : [];
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
      className="group aspect-[4/3] flex items-center justify-center overflow-hidden"
      title={client.name}
    >
      {src ? (
        <img
          src={src}
          alt={`${client.name} logo`}
          loading="lazy"
          className="max-h-[60%] w-[82%] object-contain"
          onLoad={() => { loadedRef.current = true; }}
          onError={() => setStep((s) => s + 1)}
        />
      ) : (
        <span className="px-3 text-center font-display text-lg leading-tight text-bgp-wine">
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
