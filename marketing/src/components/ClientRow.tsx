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
    // One circle size on every page, and every logo file is pre-fitted to the
    // same box on a square canvas (public/brand-logos, 512px), so the marks
    // read at the same optical weight (Woody, 2026-10-16).
    <div
      className="group h-full w-full aspect-square shrink-0 rounded-full border border-bgp-line bg-white flex items-center justify-center overflow-hidden hover:border-bgp-burgundy/40 transition-colors"
      title={client.name}
    >
      {src ? (
        <img
          src={src}
          alt={`${client.name} logo`}
          loading="lazy"
          className="h-[70%] w-[70%] object-contain"
          onLoad={() => { loadedRef.current = true; }}
          onError={() => setStep((s) => s + 1)}
        />
      ) : (
        <span className="px-3 text-center font-normal text-sm leading-tight text-bgp-wine">
          {client.name}
        </span>
      )}
    </div>
  );
}

// Same seven-across grid as Brand Representation (slide 35) on every page.
export default function ClientRow({ clients }: { clients: Client[] }) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-7 gap-4 md:gap-6">
      {clients.map((c) => (
        <ClientCircle key={c.name} client={c} />
      ))}
    </div>
  );
}
