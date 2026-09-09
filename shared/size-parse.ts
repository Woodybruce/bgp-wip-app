// Parsing a floor area out of free text.
//
// An AI-extracted size fact is prose — "31,384 sq ft", "3,938 sq ft (925 sq
// m)", "12,000-15,000 sq ft", "approx. 1,600,000 sq ft". Stripping every
// character that isn't a digit or a dot and parsing what's left glues those
// figures into one number: "3,938 sq ft (925 sq m)" becomes 3,938,925, and a
// fact naming three figures becomes a number in the quadrillions. That value
// then drives the per-sq-ft OpEx line of a Pathway model and poisons every
// number in it (a real "50 St James's Street" model shipped with a lettable
// area of 3,938,925,424,496,572,000 sq ft).
//
// So: take the first properly-formed figure only, and refuse anything outside
// a plausible building size so callers fall back to their own default.

export const MIN_PLAUSIBLE_SQFT = 50;
export const MAX_PLAUSIBLE_SQFT = 50_000_000;

/** Returns the rounded area, or null if it isn't a plausible floor area. */
export function plausibleSqFt(n: number): number | null {
  if (!Number.isFinite(n) || n < MIN_PLAUSIBLE_SQFT || n > MAX_PLAUSIBLE_SQFT) return null;
  return Math.round(n);
}

/** Parses the first figure out of a free-text size fact. Null if implausible. */
export function parseSizeSqFt(raw: unknown): number | null {
  const text = String(raw ?? "");
  const first = text.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/);
  if (!first) return null;
  return plausibleSqFt(parseFloat(first[0].replace(/,/g, "")));
}
