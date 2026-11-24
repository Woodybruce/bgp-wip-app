// Which planning applications are a property's own (Woody, 2026-11-24, on
// 26A and 26B The Pavement: the planning card listed a shipping container at
// 9 Bromell's Road and a shopfront at 22 The Pavement, because PlanIt answers
// for everything within 200m of the postcode). An application is the
// property's when its address holds one of the property's numbers on the
// property's street, or the property's building name. "26" is not "26A":
// on a street of shops they are often different buildings.
import { buildingNameKey } from "./property-ownership";

const STREET_WORDS = new Set([
  "street", "road", "lane", "avenue", "place", "square", "row", "walk", "way", "hill", "court", "gardens",
  "terrace", "parade", "pavement", "crescent", "close", "mews", "yard", "grove", "park", "green", "broadway",
  "circus", "gate", "quay", "wharf", "market", "arcade", "passage", "drive", "embankment", "bridge",
  "buildings", "rise", "vale", "end", "approach", "village", "centre", "precinct", "hall",
]);

const plain = (s: string) => s
  .toLowerCase()
  .normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[–—]/g, "-")
  .replace(/\bst\b\.?(?=\s|,|$)/g, "street")
  .replace(/\brd\b\.?(?=\s|,|$)/g, "road")
  .replace(/\bave\b\.?(?=\s|,|$)/g, "avenue")
  .replace(/[^a-z0-9,&\- ]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function textOf(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return ["formatted", "address", "line", "line1", "street", "streetAddress"]
      .map(k => (typeof o[k] === "string" ? String(o[k]) : ""))
      .filter(Boolean)
      .join(", ");
  }
  return String(value);
}

// "Flat 3, 26A The Pavement": the 3 is a flat, not a building number.
const withoutFlats = (s: string) => s.replace(/\b(?:flats?|units?|apartments?|apt|suites?|rooms?|studios?|floors?|shops?)\s+[a-z]?\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?\s*,?/g, " ");

const ITEM = String.raw`\d+[a-z]?(?:\s*(?:-|to)\s*\d+[a-z]?)?`;
const LIST = String.raw`${ITEM}(?:\s*(?:,|&|and)\s*${ITEM})*`;

function expand(list: string): string[] {
  const out = new Set<string>();
  for (const item of list.split(/\s*(?:,|&|\band\b)\s*/)) {
    const m = item.trim().match(/^(\d+)([a-z]?)(?:\s*(?:-|to)\s*(\d+)([a-z]?))?$/);
    if (!m) continue;
    if (!m[3]) { out.add(`${Number(m[1])}${m[2]}`); continue; }
    const a = Number(m[1]), b = Number(m[3]);
    if (m[2] || m[4] || b < a || b - a > 60) { out.add(`${a}${m[2]}`); out.add(`${b}${m[4]}`); continue; }
    for (let n = a; n <= b; n++) out.add(String(n));
  }
  return [...out];
}

export type PlanningPlaceKey = { numbers: string[]; street: string | null; building: string | null; searchTerm: string | null };

/** The property's numbers and street, and its building name, read from its name and address. */
export function planningPlaceKey(place: { name?: unknown; address?: unknown }): PlanningPlaceKey | null {
  const sources = [textOf(place.name), textOf(place.address)].map(s => withoutFlats(plain(s))).filter(Boolean);
  let numbers: string[] = [];
  let street: string | null = null;
  let searchTerm: string | null = null;
  for (const s of sources) {
    for (const part of s.split(",")) {
      const m = part.trim().match(new RegExp(`(?:^|\\s)(${LIST})\\s+((?:the\\s+)?[a-z][a-z\\-]*(?:\\s+[a-z][a-z\\-]*){0,5})`));
      if (!m) continue;
      const words = m[2].split(" ").filter(w => w !== "the");
      const end = words.findIndex(w => STREET_WORDS.has(w));
      const kept = end >= 0 ? words.slice(0, end + 1) : words.slice(0, 2);
      if (!kept.length) continue;
      numbers = expand(m[1]);
      street = kept.join(" ");
      searchTerm = `${numbers[0]} ${/^the\s/.test(m[2]) ? "the " : ""}${street}`;
      break;
    }
    if (street) break;
  }
  const building = buildingNameKey(place.name);
  if (!street && !building) return null;
  return { numbers, street, building, searchTerm: searchTerm || building };
}

function numbersOn(addressText: string, street: string): string[] {
  const s = withoutFlats(plain(addressText));
  const escaped = street.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^0-9a-z])(${LIST})\\s*,?\\s+(?:the\\s+)?${escaped}\\b`, "g");
  const out = new Set<string>();
  for (const m of s.matchAll(re)) for (const n of expand(m[1])) out.add(n);
  return [...out];
}

/** Why an application's address is the property's, or null when it is only nearby. */
export function planningAddressFit(applicationAddress: unknown, key: PlanningPlaceKey | null): "address" | "name" | null {
  if (!key) return null;
  const at = textOf(applicationAddress);
  if (!at.trim()) return null;
  if (key.street && key.numbers.length) {
    const theirs = numbersOn(at, key.street);
    if (theirs.some(n => key.numbers.includes(n))) return "address";
  }
  if (key.building) {
    const words = ` ${at.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()} `;
    if (words.includes(` ${key.building} `)) return "name";
  }
  return null;
}

/** The year in a council reference: "13/04314/FUL" is 2013. Null when the reference does not start with one. */
export function referenceYear(reference: string): number | null {
  const m = reference.trim().match(/^(\d{2})\/\d+/);
  if (!m) return null;
  const yy = Number(m[1]);
  const now = new Date().getFullYear() % 100;
  return yy <= now ? 2000 + yy : 1900 + yy;
}
