// Image slot: renders the photo when src is given, otherwise a wireframe-style
// placeholder. Current photos are Unsplash stock (free licence) — swap for real
// BGP photography as it arrives.
import { useEffect, useState } from "react";

export default function Placeholder({
  label = "Image TBC",
  className = "",
  src,
  alt = "",
}: {
  label?: string;
  className?: string;
  src?: string;
  alt?: string;
}) {
  // A photo that fails to load falls back to the placeholder instead of a
  // broken-image icon (Frankie Shop, 2026-10-13).
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (src && !failed) {
    return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`object-cover ${className}`} />;
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
