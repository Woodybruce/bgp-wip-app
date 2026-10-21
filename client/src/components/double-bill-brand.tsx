// Double Bill brand marks for the app (see server/leisure-platform-brand.ts
// for the tokens and docs/leisure-platform/BRAND.md for the system).
// The marks inherit the text colour for ink so they sit on light and dark
// surfaces; the amber is the brand's one accent and stays fixed.

export const DOUBLE_BILL_AMBER = "#E89A1C";

export function DoubleBillMark({ size = 32, className }: { size?: number; className?: string }) {
  const w = Math.round(size * 1.1);
  return (
    <svg width={w} height={size} viewBox="0 0 44 40" role="img" aria-label="Double Bill" className={className}>
      <g transform="rotate(-12 18 22)">
        <rect x="4" y="8" width="26" height="30" rx="4" fill="currentColor" />
        <circle cx="4" cy="23" r="3" className="fill-background" />
        <circle cx="30" cy="23" r="3" className="fill-background" />
      </g>
      <g transform="rotate(8 26 20)">
        <rect x="14" y="4" width="26" height="30" rx="4" fill={DOUBLE_BILL_AMBER} />
        <circle cx="14" cy="19" r="3" className="fill-background" />
        <circle cx="40" cy="19" r="3" className="fill-background" />
        <rect x="20" y="12" width="14" height="2.4" rx="1.2" fill="#fff" opacity=".9" />
        <rect x="20" y="18" width="9" height="2.4" rx="1.2" fill="#fff" opacity=".9" />
      </g>
    </svg>
  );
}

export function DoubleBillWordmark({ height = 40, className }: { height?: number; className?: string }) {
  const w = Math.round((190 / 44) * height);
  return (
    <svg width={w} height={height} viewBox="0 0 190 44" role="img" aria-label="Double Bill, leisure parks" className={className}>
      <g transform="translate(0 2)">
        <g transform="rotate(-12 18 22)">
          <rect x="4" y="8" width="26" height="30" rx="4" fill="currentColor" />
          <circle cx="4" cy="23" r="3" className="fill-background" />
          <circle cx="30" cy="23" r="3" className="fill-background" />
        </g>
        <g transform="rotate(8 26 20)">
          <rect x="14" y="4" width="26" height="30" rx="4" fill={DOUBLE_BILL_AMBER} />
          <circle cx="14" cy="19" r="3" className="fill-background" />
          <circle cx="40" cy="19" r="3" className="fill-background" />
          <rect x="20" y="12" width="14" height="2.4" rx="1.2" fill="#fff" opacity=".9" />
          <rect x="20" y="18" width="9" height="2.4" rx="1.2" fill="#fff" opacity=".9" />
        </g>
      </g>
      <text x="54" y="21" fontFamily="'Bricolage Grotesque','Arial Narrow',Arial,sans-serif" fontWeight="800" fontSize="19" letterSpacing="-0.4" fill="currentColor">DOUBLE BILL</text>
      <text x="55" y="36" fontFamily="'Instrument Sans','Segoe UI',system-ui,sans-serif" fontWeight="600" fontSize="9.5" letterSpacing="2.2" fill={DOUBLE_BILL_AMBER}>LEISURE PARKS</text>
    </svg>
  );
}
