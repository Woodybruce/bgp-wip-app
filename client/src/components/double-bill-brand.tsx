// Double Bill brand marks for the app (tokens and the written system are in
// server/leisure-platform-brand.ts and docs/leisure-platform/BRAND.md).
// v2: the marquee badge — midnight-velvet ground, bulb-lit gold border, the
// two ticket stubs inside — and a Bodoni wordmark with a gold sheen.
import { useId } from "react";

function GoldDefs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#F6E6B2" />
        <stop offset=".45" stopColor="#D4B165" />
        <stop offset=".7" stopColor="#C19A45" />
        <stop offset="1" stopColor="#8F6E2A" />
      </linearGradient>
      <linearGradient id={`${id}-ivory`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#FFFCF3" />
        <stop offset="1" stopColor="#E9E0CC" />
      </linearGradient>
      <radialGradient id={`${id}-velvet`} cx=".3" cy=".2" r="1">
        <stop offset="0" stopColor="#4A1024" />
        <stop offset=".55" stopColor="#141830" />
        <stop offset="1" stopColor="#0B0F1F" />
      </radialGradient>
    </defs>
  );
}

function bulbPoints(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const n = 6, inset = 6.5, span = 56 - inset * 2;
  for (let i = 0; i < n; i++) {
    const t = inset + (span * i) / (n - 1);
    pts.push([t, inset], [t, 56 - inset]);
  }
  for (let i = 1; i < n - 1; i++) {
    const t = inset + (span * i) / (n - 1);
    pts.push([inset, t], [56 - inset, t]);
  }
  return pts;
}

function Badge({ id }: { id: string }) {
  return (
    <>
      <rect x="1.25" y="1.25" width="53.5" height="53.5" rx="11" fill={`url(#${id}-velvet)`} stroke={`url(#${id}-gold)`} strokeWidth="1.5" />
      <rect x="4.5" y="4.5" width="47" height="47" rx="8.5" fill="none" stroke={`url(#${id}-gold)`} strokeWidth=".6" opacity=".7" />
      {bulbPoints().map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="1.5" fill={`url(#${id}-gold)`} />
          <circle cx={x} cy={y} r="0.6" fill="#FFF7DD" />
        </g>
      ))}
      <g transform="rotate(-14 24 32)">
        <rect x="14" y="20" width="19" height="23" rx="3" fill={`url(#${id}-ivory)`} />
        <circle cx="14" cy="31.5" r="2.4" fill="#141830" />
        <circle cx="33" cy="31.5" r="2.4" fill="#141830" />
      </g>
      <g transform="rotate(9 32 26)">
        <rect x="22" y="14" width="19" height="23" rx="3" fill={`url(#${id}-gold)`} />
        <circle cx="22" cy="25.5" r="2.4" fill="#141830" />
        <circle cx="41" cy="25.5" r="2.4" fill="#141830" />
        <rect x="26.5" y="20" width="10" height="1.8" rx=".9" fill="#2A1E0A" opacity=".55" />
        <rect x="26.5" y="24.5" width="6.5" height="1.8" rx=".9" fill="#2A1E0A" opacity=".55" />
      </g>
    </>
  );
}

export function DoubleBillMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" role="img" aria-label="Double Bill" className={className}>
      <GoldDefs id={id} />
      <Badge id={id} />
    </svg>
  );
}

export function DoubleBillWordmark({ height = 48, className }: { height?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const w = Math.round((248 / 56) * height);
  return (
    <svg width={w} height={height} viewBox="0 0 248 56" role="img" aria-label="Double Bill, leisure parks" className={className}>
      <GoldDefs id={id} />
      <Badge id={id} />
      <text x="68" y="30" fontFamily="'Bodoni Moda','Didot','Bodoni 72','Playfair Display',Georgia,serif" fontWeight="700" fontSize="26" letterSpacing="1.6" fill={`url(#${id}-gold)`}>DOUBLE BILL</text>
      <line x1="69" y1="37.5" x2="156" y2="37.5" stroke={`url(#${id}-gold)`} strokeWidth=".8" />
      <path d="M160 34.5 l3 3 -3 3 -3 -3z" fill={`url(#${id}-gold)`} />
      <line x1="164" y1="37.5" x2="246" y2="37.5" stroke={`url(#${id}-gold)`} strokeWidth=".8" />
      <text x="69" y="50" fontFamily="'Instrument Sans','Segoe UI',system-ui,sans-serif" fontWeight="600" fontSize="9.5" letterSpacing="3.6" className="fill-muted-foreground">LEISURE PARKS</text>
    </svg>
  );
}
