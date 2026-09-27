// Display form of a requirement size string. Imported sizes arrive as
// "10000- ft2" (open-ended) or "8382-10764 ft2" (sqm converted); show them
// as "10,000+ sq ft" / "8,382–10,764 sq ft" (Woody, 2026-09-27). Stored
// values are never rewritten — this is display only.
const RANGE_RE = /^(?:c\.?\s*)?([\d,]+(?:\.\d+)?)\s*(?:(-|–|—|to)\s*([\d,]+(?:\.\d+)?)?)?\s*(ft2|ft²|sq\.?\s*ft\.?|sqft|sf)?\s*(\+)?$/i;

const num = (v: string) => Math.round(Number(v.replace(/,/g, ""))).toLocaleString("en-GB");

export function formatSizeText(raw: string): string {
  const s = (raw || "").trim();
  const m = s.match(RANGE_RE);
  if (!m) return s.replace(/\s*ft(?:2|²)(?!\w)/gi, " sq ft");
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
