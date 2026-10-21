// Double Bill — the brand for the cinema-anchored leisure-park platform.
// One source for the name, tokens and SVG marks; the public page, the
// dashboard component and docs/leisure-platform/BRAND.md all draw on it.
//
// v2 (Woody, 21 Oct 2026: "more bling, elevated"): a marquee. Midnight and
// velvet grounds, champagne gold with a metallic sheen as the accent, a
// bulb-lit badge for the mark and a Bodoni wordmark.
//
// Name cleared against Companies House on 2026-10-21 (no company name
// contains "DOUBLE BILL"; "Encore Leisure" and "Foyer Leisure" are taken).
// Trade-mark search at the IPO still to run before anything is printed.

export const BRAND = {
  name: "Double Bill",
  descriptor: "Leisure parks",
  tagline: "Twice the night out.",
  line: "Cinema-anchored leisure parks, run again: film, then the rest of the night, on one site with one landlord who cares.",
  preparedBy: "Bruce Gillingham Pollard",
  colours: {
    midnight: { light: "#0B0F1F", dark: "#070A16", role: "Midnight · the auditorium; header band, the badge, active pills" },
    velvet: { light: "#4A1024", dark: "#3A0C1C", role: "Velvet · the curtain; wash behind the header, hover states" },
    gold: { light: "#C9A24E", dark: "#D9B86A", role: "Champagne gold · the one accent: marks, rules, links, active underline" },
    goldHi: { light: "#F3DFA0", dark: "#F6E6B2", role: "Gold highlight · top of the metallic sheen" },
    goldLo: { light: "#8F6E2A", dark: "#A6823A", role: "Gold shadow · bottom of the sheen; link colour on ivory" },
    ivory: { light: "#F6F1E6", dark: "#121626", role: "Ivory · page background (midnight in dark mode)" },
    card: { light: "#FFFDF8", dark: "#1A1F32", role: "Card surfaces" },
    ink: { light: "#171A26", dark: "#F1ECE1", role: "Text" },
    muted: { light: "#6E6A62", dark: "#A9A396", role: "Secondary text" },
    line: { light: "#E4DCCB", dark: "#2C3147", role: "Hairlines" },
    good: { light: "#2C7D5B", dark: "#6FCB9B", role: "Good · confirmed, sound covenants" },
    warn: { light: "#9A6B12", dark: "#E0B45A", role: "Warn · likely, watch list" },
    usher: { light: "#B5383A", dark: "#F08A86", role: "Usher red · critical and voids only" },
  },
  type: {
    display: { family: "Bodoni Moda", fallback: "\"Didot\", \"Bodoni 72\", \"Playfair Display\", Georgia, serif", role: "Display: wordmark, page titles, big numbers; 700, tracked slightly open in capitals" },
    body: { family: "Instrument Sans", fallback: "\"Segoe UI\", system-ui, sans-serif", role: "Body and UI: 14px running text, labels, tables" },
    mono: { family: "JetBrains Mono", fallback: "ui-monospace, Menlo, monospace", role: "Data: money, yields, title numbers, dates; tabular numerals" },
  },
  googleFontsHref:
    "https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,600;6..96,700&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap",
  voice: [
    "Short sentences. Plain words. British spelling.",
    "Talk about nights out, not footfall; occupiers by name, never 'tenants' on anything a visitor sees.",
    "One number per sentence. The mark does the shouting; the copy stays calm.",
    "Never 'destination', 'experiential' or 'curated'.",
  ],
  parkNaming: "Parks keep their own names (Valley Centertainment, BH2, Coliseum). Double Bill signs the landlord line: 'A Double Bill park'.",
};

type MarkOpts = { id?: string; onLight?: boolean };

function goldDefs(id: string) {
  return `<defs>
    <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6E6B2"/><stop offset=".45" stop-color="#D4B165"/><stop offset=".7" stop-color="#C19A45"/><stop offset="1" stop-color="#8F6E2A"/></linearGradient>
    <linearGradient id="${id}-ivory" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFCF3"/><stop offset="1" stop-color="#E9E0CC"/></linearGradient>
    <radialGradient id="${id}-velvet" cx=".3" cy=".2" r="1"><stop offset="0" stop-color="#4A1024"/><stop offset=".55" stop-color="#141830"/><stop offset="1" stop-color="#0B0F1F"/></radialGradient>
  </defs>`;
}

/** Bulb positions around a rounded badge of the given size (inset by 6). */
function bulbs(size: number, id: string): string {
  const pts: Array<[number, number]> = [];
  const n = 6;
  const inset = 6.5;
  const span = size - inset * 2;
  for (let i = 0; i < n; i++) {
    const t = inset + (span * i) / (n - 1);
    pts.push([t, inset], [t, size - inset]);
  }
  for (let i = 1; i < n - 1; i++) {
    const t = inset + (span * i) / (n - 1);
    pts.push([inset, t], [size - inset, t]);
  }
  return pts
    .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.5" fill="url(#${id}-gold)"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.6" fill="#FFF7DD"/>`)
    .join("");
}

/**
 * The mark: a marquee badge. Midnight-velvet ground, a bulb-lit gold border,
 * and the two ticket stubs fanned inside (ivory behind, gold in front).
 * `size` is the rendered height in px; the drawing is a 56-unit square.
 */
export function monogramSvg(size = 40, opts: MarkOpts = {}): string {
  const id = opts.id || "db";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 56 56" role="img" aria-label="Double Bill">
  ${goldDefs(id)}
  <rect x="1.25" y="1.25" width="53.5" height="53.5" rx="11" fill="url(#${id}-velvet)" stroke="url(#${id}-gold)" stroke-width="1.5"/>
  <rect x="4.5" y="4.5" width="47" height="47" rx="8.5" fill="none" stroke="url(#${id}-gold)" stroke-width=".6" opacity=".7"/>
  ${bulbs(56, id)}
  <g transform="rotate(-14 24 32)"><rect x="14" y="20" width="19" height="23" rx="3" fill="url(#${id}-ivory)"/><circle cx="14" cy="31.5" r="2.4" fill="#141830"/><circle cx="33" cy="31.5" r="2.4" fill="#141830"/></g>
  <g transform="rotate(9 32 26)"><rect x="22" y="14" width="19" height="23" rx="3" fill="url(#${id}-gold)"/><circle cx="22" cy="25.5" r="2.4" fill="#141830"/><circle cx="41" cy="25.5" r="2.4" fill="#141830"/><rect x="26.5" y="20" width="10" height="1.8" rx=".9" fill="#2A1E0A" opacity=".55"/><rect x="26.5" y="24.5" width="6.5" height="1.8" rx=".9" fill="#2A1E0A" opacity=".55"/></g>
</svg>`;
}

/**
 * Wordmark: the badge, then DOUBLE BILL in Bodoni with the gold sheen, a
 * hairline rule with a centre diamond, and LEISURE PARKS tracked beneath.
 * `onLight` sets the descriptor colour for ivory grounds.
 */
export function wordmarkSvg(height = 48, opts: MarkOpts = {}): string {
  const id = opts.id || "dbw";
  const w = Math.round((248 / 56) * height);
  const desc = opts.onLight ? "#6E6A62" : "#D9CDB0";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 248 56" role="img" aria-label="Double Bill, leisure parks">
  ${goldDefs(id)}
  <rect x="1.25" y="1.25" width="53.5" height="53.5" rx="11" fill="url(#${id}-velvet)" stroke="url(#${id}-gold)" stroke-width="1.5"/>
  <rect x="4.5" y="4.5" width="47" height="47" rx="8.5" fill="none" stroke="url(#${id}-gold)" stroke-width=".6" opacity=".7"/>
  ${bulbs(56, id)}
  <g transform="rotate(-14 24 32)"><rect x="14" y="20" width="19" height="23" rx="3" fill="url(#${id}-ivory)"/><circle cx="14" cy="31.5" r="2.4" fill="#141830"/><circle cx="33" cy="31.5" r="2.4" fill="#141830"/></g>
  <g transform="rotate(9 32 26)"><rect x="22" y="14" width="19" height="23" rx="3" fill="url(#${id}-gold)"/><circle cx="22" cy="25.5" r="2.4" fill="#141830"/><circle cx="41" cy="25.5" r="2.4" fill="#141830"/><rect x="26.5" y="20" width="10" height="1.8" rx=".9" fill="#2A1E0A" opacity=".55"/><rect x="26.5" y="24.5" width="6.5" height="1.8" rx=".9" fill="#2A1E0A" opacity=".55"/></g>
  <text x="68" y="30" font-family="'Bodoni Moda','Didot','Bodoni 72','Playfair Display',Georgia,serif" font-weight="700" font-size="26" letter-spacing="1.6" fill="url(#${id}-gold)">DOUBLE BILL</text>
  <line x1="69" y1="37.5" x2="156" y2="37.5" stroke="url(#${id}-gold)" stroke-width=".8"/>
  <path d="M160 34.5 l3 3 -3 3 -3 -3z" fill="url(#${id}-gold)"/>
  <line x1="164" y1="37.5" x2="246" y2="37.5" stroke="url(#${id}-gold)" stroke-width=".8"/>
  <text x="69" y="50" font-family="'Instrument Sans','Segoe UI',system-ui,sans-serif" font-weight="600" font-size="9.5" letter-spacing="3.6" fill="${desc}">LEISURE PARKS</text>
</svg>`;
}
