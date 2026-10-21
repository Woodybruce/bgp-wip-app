// Double Bill — the brand for the cinema-anchored leisure-park platform.
// One source for the name, tokens and SVG marks; the public page, the
// dashboard component and docs/leisure-platform/BRAND.md all draw on it.
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
    ink: { light: "#131A2B", dark: "#0E1320", role: "Ink · the auditorium; headings, the mark, dark surfaces" },
    screen: { light: "#F3F3EF", dark: "#161B29", role: "Screen · page background" },
    card: { light: "#FFFFFF", dark: "#1D2334", role: "Card surfaces" },
    houselights: { light: "#E89A1C", dark: "#F0B142", role: "House lights · the one accent: marks, active pills, links" },
    usher: { light: "#C9423E", dark: "#F08A86", role: "Usher red · critical and voids only" },
    good: { light: "#2C8C63", dark: "#6FCB9B", role: "Good · confirmed, sound covenants" },
    warn: { light: "#9C6A00", dark: "#E0B45A", role: "Warn · likely, watch list" },
    muted: { light: "#6B7080", dark: "#A3A9B8", role: "Muted text and rules" },
    line: { light: "#DDDFE4", dark: "#2B3245", role: "Hairlines" },
  },
  type: {
    display: { family: "Bricolage Grotesque", fallback: "\"Arial Narrow\", \"Helvetica Neue\", Arial, sans-serif", role: "Display: wordmark, page titles, section heads; weight 700-800, tight tracking" },
    body: { family: "Instrument Sans", fallback: "\"Segoe UI\", system-ui, sans-serif", role: "Body and UI: 14px running text, labels, tables" },
    mono: { family: "JetBrains Mono", fallback: "ui-monospace, Menlo, monospace", role: "Data: money, yields, title numbers, dates; tabular numerals" },
  },
  googleFontsHref:
    "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap",
  voice: [
    "Short sentences. Plain words. British spelling.",
    "Talk about nights out, not footfall; occupiers by name, never 'tenants' on anything a visitor sees.",
    "One number per sentence. The mark does the shouting; the copy stays calm.",
    "Never 'destination', 'experiential' or 'curated'.",
  ],
  parkNaming: "Parks keep their own names (Valley Centertainment, BH2, Coliseum). Double Bill signs the landlord line: 'A Double Bill park'.",
};

/**
 * The mark: two ticket stubs fanned, the back one in ink and the front one
 * in house-lights amber, each with the perforated edge notch. Reads as
 * 'two tickets, one night'. `size` is the height in px.
 */
export function monogramSvg(size = 40, opts: { ink?: string; accent?: string; paper?: string } = {}): string {
  const ink = opts.ink || "currentColor";
  const accent = opts.accent || "#E89A1C";
  const paper = opts.paper || "#FFFFFF";
  const w = Math.round(size * 1.1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size}" viewBox="0 0 44 40" role="img" aria-label="Double Bill">
  <g transform="rotate(-12 18 22)"><rect x="4" y="8" width="26" height="30" rx="4" fill="${ink}"/><circle cx="4" cy="23" r="3" fill="${paper}"/><circle cx="30" cy="23" r="3" fill="${paper}"/></g>
  <g transform="rotate(8 26 20)"><rect x="14" y="4" width="26" height="30" rx="4" fill="${accent}"/><circle cx="14" cy="19" r="3" fill="${paper}"/><circle cx="40" cy="19" r="3" fill="${paper}"/><rect x="20" y="12" width="14" height="2.4" rx="1.2" fill="${paper}" opacity=".9"/><rect x="20" y="18" width="9" height="2.4" rx="1.2" fill="${paper}" opacity=".9"/></g>
</svg>`;
}

/** Wordmark: the mark plus the name in the display face, two lines, as a cinema letterboard. */
export function wordmarkSvg(height = 44, opts: { ink?: string; accent?: string; paper?: string } = {}): string {
  const ink = opts.ink || "currentColor";
  const accent = opts.accent || "#E89A1C";
  const paper = opts.paper || "#FFFFFF";
  const scale = height / 44;
  const w = Math.round(190 * scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 190 44" role="img" aria-label="Double Bill, leisure parks">
  <g transform="translate(0 2)"><g transform="rotate(-12 18 22)"><rect x="4" y="8" width="26" height="30" rx="4" fill="${ink}"/><circle cx="4" cy="23" r="3" fill="${paper}"/><circle cx="30" cy="23" r="3" fill="${paper}"/></g>
  <g transform="rotate(8 26 20)"><rect x="14" y="4" width="26" height="30" rx="4" fill="${accent}"/><circle cx="14" cy="19" r="3" fill="${paper}"/><circle cx="40" cy="19" r="3" fill="${paper}"/><rect x="20" y="12" width="14" height="2.4" rx="1.2" fill="${paper}" opacity=".9"/><rect x="20" y="18" width="9" height="2.4" rx="1.2" fill="${paper}" opacity=".9"/></g></g>
  <text x="54" y="21" font-family="'Bricolage Grotesque','Arial Narrow',Arial,sans-serif" font-weight="800" font-size="19" letter-spacing="-0.4" fill="${ink}">DOUBLE BILL</text>
  <text x="55" y="36" font-family="'Instrument Sans','Segoe UI',system-ui,sans-serif" font-weight="600" font-size="9.5" letter-spacing="2.2" fill="${accent}">LEISURE PARKS</text>
</svg>`;
}
