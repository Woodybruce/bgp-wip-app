// Image slot: renders the photo when src is given, otherwise a stock photo
// from the pool below with an italic placeholder tag so the team can see
// what still needs a real picture (Woody, 2026-10-16). Pass stock={false}
// for slots that are not photos (maps), which keep the wireframe cross.
import { useEffect, useState } from "react";

// These bundled assets are documented stand-ins for Golden Square, Upper
// Street and Frankie Shop. Keep their temporary status visible even when
// a content record supplies them through its normal image field.
const KNOWN_PLACEHOLDER_IMAGES = new Set([
  "/images/city-towers.jpg", "/images/shop-boutique.jpg", "/images/shop-rails.jpg",
]);

const STOCK_POOL = [
  "/images/shop-boutique.jpg", "/images/shop-menswear.jpg", "/images/shop-browse.jpg", "/images/restaurant.jpg",
  "/images/cafe.jpg", "/images/bar.jpg", "/images/food-hall.jpg", "/images/gym.jpg", "/images/cinema.jpg",
  "/images/hero-london.jpg", "/images/city-towers.jpg", "/images/tower-bridge.jpg", "/images/westminster.jpg",
  "/images/st-christophers-place.jpg", "/images/royal-exchange.jpg", "/images/lease-signing.jpg", "/images/office.jpg",
];
const STOCK_BY_WORD: Array<[RegExp, string]> = [
  [/restaurant|dining|food|kitchen/i, "/images/restaurant.jpg"],
  [/caf[eé]|coffee/i, "/images/cafe.jpg"],
  [/bar|pub/i, "/images/bar.jpg"],
  [/gym|fitness|studio|wellness/i, "/images/gym.jpg"],
  [/cinema|leisure/i, "/images/cinema.jpg"],
  [/city|square mile|office/i, "/images/city-towers.jpg"],
  [/high street|shop|retail|boutique|store|brand/i, "/images/shop-boutique.jpg"],
  [/invest|deal|sale|acqui/i, "/images/lease-signing.jpg"],
  [/london|estate|street/i, "/images/st-christophers-place.jpg"],
];
export function stockFor(key: string): string {
  for (const [re, src] of STOCK_BY_WORD) if (re.test(key)) return src;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return STOCK_POOL[h % STOCK_POOL.length];
}

export default function Placeholder({
  label = "Image TBC",
  className = "",
  src,
  alt = "",
  stock,
}: {
  label?: string;
  className?: string;
  src?: string;
  alt?: string;
  stock?: string | false;
}) {
  // A photo that fails to load falls back to the placeholder instead of a
  // broken-image icon (Frankie Shop, 2026-10-13).
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { setFailed(false); setRetry(0); }, [src]);
  const suppliedPlaceholder = !!src && KNOWN_PLACEHOLDER_IMAGES.has(src);
  if (src && !failed && !suppliedPlaceholder) {
    // One retry on a momentary drop before falling back (Woody, 2026-10-15).
    const url = retry ? `${src}${src.includes("?") ? "&" : "?"}r=${retry}` : src;
    return <img src={url} alt={alt} loading="lazy" onError={() => (retry ? setFailed(true) : setTimeout(() => setRetry(1), 1500))} className={`object-cover ${className}`} />;
  }
  if (stock !== false) {
    const url = suppliedPlaceholder && !failed ? src : typeof stock === "string" ? stock : stockFor(alt || label);
    return (
      <div className={`relative overflow-hidden ${className}`}>
        <img src={url} alt={alt} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        <span className="absolute left-2 bottom-2 bg-bgp-cream/90 px-2 py-0.5 text-[11px] italic text-bgp-wine">Placeholder image — to be replaced</span>
      </div>
    );
  }
  return (
    <div className={`relative overflow-hidden bg-bgp-mist ${className}`}>
      <svg className="absolute inset-0 h-full w-full text-bgp-stone/50" preserveAspectRatio="none" viewBox="0 0 100 100">
        <line x1="0" y1="0" x2="100" y2="100" stroke="currentColor" strokeWidth="0.4" />
        <line x1="100" y1="0" x2="0" y2="100" stroke="currentColor" strokeWidth="0.4" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center label-caps text-bgp-stone">{label}</span>
    </div>
  );
}
