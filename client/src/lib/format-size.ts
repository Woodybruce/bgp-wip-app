// Display form of a requirement size string. Imported sizes arrive as
// "10000- ft2" (open-ended) or "8382-10764 ft2" (sqm converted); show them
// as "10,000+ sq ft" / "8,382–10,764 sq ft" (Woody, 2026-09-27). Stored
// values are never rewritten — this is display only.
const RANGE_RE = /^(?:c\.?\s*)?([\d,]+(?:\.\d+)?)\s*(?:(-|–|—|to)\s*([\d,]+(?:\.\d+)?)?)?\s*(ft2|ft²|sq\.?\s*ft\.?|sqft|sf)?\s*(\+)?$/i;

const num = (v: string) => Math.round(Number(v.replace(/,/g, ""))).toLocaleString("en-GB");

// Prose sizes ("Minimum 3,000 sq ft of internal space", "500–1,000 sq ft
// modular building footprint; circa …") — chip shows the leading size range
// only: "3,000+ sq ft" / "500–1,000 sq ft" (Woody, 2026-09-27).
// Metric sizes keep their unit ("3,500 sqm to 10,000 sqm gross area" →
// "3,500–10,000 sq m"), a unit may follow both numbers, and an inverted
// range ("6,000–2,500") reads low to high (Woody, 2026-09-28).
const UNIT_SRC = String.raw`(?:ft2|ft²|sq\.?\s*ft\b\.?|sqft\b|sf\b|square\s+f(?:ee|oo)t\b|m2\b|m²|sq\.?\s*m\b\.?|sqm\b|square\s+met(?:re|er)s?\b)`;
const PROSE_RE = new RegExp(String.raw`(?:\b(min(?:imum)?|from|at least|over|in excess of|up to|max(?:imum)?)\.?\s+)?(?:c\.?\s*|circa\s+|approx\.?\s*)?([\d,]*\d(?:\.\d+)?)\s*(?:${UNIT_SRC}\s*)?(?:(-|–|—|to)\s*([\d,]*\d(?:\.\d+)?))?\s*(${UNIT_SRC})`, "i");
const isMetric = (unit: string) => /m2|m²|sq\.?\s*m\b|sqm|met(?:re|er)/i.test(unit);
const ordered = (a: string, b: string): [string, string] => Number(a.replace(/,/g, "")) > Number(b.replace(/,/g, "")) ? [b, a] : [a, b];

export function formatSizeText(raw: string): string {
  const s = (raw || "").trim();
  const m = s.match(RANGE_RE);
  if (!m) {
    const p = s.match(PROSE_RE);
    if (p) {
      const [, qual, pmin, , pmax, punit] = p;
      const q = (qual || "").toLowerCase();
      const u = isMetric(punit) ? " sq m" : " sq ft";
      if (pmax) { const [lo, hi] = ordered(pmin, pmax); return `${num(lo)}–${num(hi)}${u}`; }
      if (q.startsWith("up to") || q.startsWith("max")) return `Up to ${num(pmin)}${u}`;
      if (q) return `${num(pmin)}+${u}`;
      return `${num(pmin)}${u}`;
    }
    return s.replace(/\s*ft(?:2|²)(?!\w)/gi, " sq ft");
  }
  const [, min, dash, max, unit, plus] = m;
  if (!unit && !dash && !plus) return s;
  const suffix = unit ? " sq ft" : "";
  if (max) { const [lo, hi] = ordered(min, max); return `${num(lo)}–${num(hi)}${suffix}`; }
  if (dash || plus) return `${num(min)}+${suffix}`;
  return `${num(min)}${suffix}`;
}

export function formatSizeList(sizes: string[] | string | null | undefined): string {
  const list = Array.isArray(sizes) ? sizes : sizes ? [sizes] : [];
  return list.map(formatSizeText).join(", ");
}
