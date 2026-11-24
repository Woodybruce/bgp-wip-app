// Landsec's schedules name a unit with its level on the end ("254 Queen
// Street (U30), Westgate, OX1 1PE - Upper Level"), while the floor is its own
// column (Woody, 2026-11-24: "adding floor name onto the unit name at the end
// ... can that be stopped"). The level comes off the name only when it is the
// row's own floor, so "- Roof" on a row whose floor is Second, or "- Whole
// Demise", stays.
const plain = (s: unknown) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function withoutFloorSuffix(unitName: unknown, floor: unknown): string {
  const name = String(unitName ?? "");
  const level = plain(floor);
  if (!level) return name;
  const m = name.match(/^(.*\S)\s*[-–—]\s*([^-–—]+?)\s*$/);
  if (!m || plain(m[2]) !== level) return name;
  return m[1].replace(/[\s,]+$/, "");
}
