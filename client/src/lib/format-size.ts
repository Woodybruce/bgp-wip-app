// Display form of a requirement size string. Imported sizes arrive as
// "10000- ft2" (open-ended) or "8382-10764 ft2" (sqm converted); show them
// as "10,000+ sq ft" / "8,382–10,764 sq ft" (Woody, 2026-09-27). Stored
// values are never rewritten — this is display only.
const RANGE_RE = /^(?:c\.?\s*)?([\d,]+(?:\.\d+)?)\s*(?:(-|–|—|to)\s*([\d,]+(?:\.\d+)?)?)?\s*(ft2|ft²|sq\.?\s*ft\.?|sqft|sf)?\s*(\+)?$/i;

const num = (v: string) => Math.round(Number(v.replace(/,/g, ""))).toLocaleString("en-GB");

// Prose sizes ("Minimum 3,000 sq ft of internal space", "500–1,000 sq ft
// modular building footprint; circa …") — chip shows the leading size range
// only: "3,000+ sq ft" / "500–1,000 sq ft" (Woody, 2026-09-27).
const PROSE_RE = /(?:\b(min(?:imum)?|from|at least|over|in excess of|up to|max(?:imum)?)\.?\s+)?(?:c\.?\s*|circa\s+|approx\.?\s*)?([\d,]*\d(?:\.\d+)?)\s*(?:(-|–|—|to)\s*([\d,]*\d(?:\.\d+)?))?\s*(?:ft2|ft²|sq\.?\s*ft\b\.?|sqft\b|sf\b)/i;

export function formatSizeText(raw: string): string {
  const s = (raw || "").trim();
  const m = s.match(RANGE_RE);
  if (!m) {
    const p = s.match(PROSE_RE);
    if (p) {
      const [, qual, pmin, , pmax] = p;
      const q = (qual || "").toLowerCase();
      if (pmax) return `${num(pmin)}–${num(pmax)} sq ft`;
      if (q.startsWith("up to") || q.startsWith("max")) return `Up to ${num(pmin)} sq ft`;
      if (q) return `${num(pmin)}+ sq ft`;
      return `${num(pmin)} sq ft`;
    }
    return s.replace(/\s*ft(?:2|²)(?!\w)/gi, " sq ft");
  }
  const [, min, dash, max, unit, plus] = m;
  if (!unit && !dash && !plus) return s;
  const suffix = unit ? " sq ft" : "";
  if (max) return `${num(min)}–${num(max)}${suffix}`;
  if (dash || plus) return `${num(min)}+${suffix}`;
  return `${num(min)}${suffix}`;
}

export function formatSizeList(sizes: string[] | string | null | undefined): string {
  const list = Array.isArray(sizes) ? sizes : sizes ? [sizes] : [];
  return list.map(formatSizeText).join(", ");
}
