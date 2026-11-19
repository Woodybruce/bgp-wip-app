// Requirement ↔ unit fit rules. Every screen that says a leasing requirement
// fits a unit asks requirementFit below (the one fit rule, 19 November 2026).
// A requirement's size text ("1,500-3,000 sq ft", "2000+", "4000") becomes a
// tolerance-widened range; use hints pair requirement uses with unit names /
// use classes.
import { rejoinSplitSizes } from "./format-size";
export const parseReqSize = (size: string[] | string | null): { min: number; max: number } | null => {
  // A list split at its thousands commas (["5", "000 - 10", "000 sq ft"]) is
  // put back together first: joined as it was, it read as a 0 to 10 sq ft range.
  const raw = (Array.isArray(size) ? rejoinSplitSizes(size).join(" ") : size || "").replace(/,/g, "");
  const range = raw.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return { min: +range[1] * 0.8, max: +range[2] * 1.2 };
  const open = raw.match(/(\d+)\s*-/);
  if (open) return { min: +open[1] * 0.8, max: +open[1] * 5 };
  const single = raw.match(/(\d{3,})/);
  if (single) return { min: +single[1] * 0.6, max: +single[1] * 1.6 };
  return null;
};

// The opening words of a pitch sentence ("Fits their 5,000–10,000 sq ft
// requirement"). parseReqSize's range carries a tolerance, so a unit inside
// it is only "Close to" the requirement unless it is inside the range as
// stated; and where the requirement names places and the unit is at none of
// them, only the size is said to fit. Null = outside the tolerance too.
export function pitchFitWords(req: { size?: string[] | string | null; requirement_locations?: string[] | null },
  unit: { sqft?: number | null; property_text: string }): "Fits" | "Size fits" | "Close to" | null {
  const range = parseReqSize(req.size ?? null);
  const sqft = Number(unit.sqft) || 0;
  if (!range || !sqft || sqft < range.min || sqft > range.max) return null;
  const raw = (Array.isArray(req.size) ? rejoinSplitSizes(req.size).join(" ") : req.size || "").replace(/,/g, "");
  const both = raw.match(/(\d+)\s*-\s*(\d+)/), open = both ? null : raw.match(/(\d+)\s*-/), single = both || open ? null : raw.match(/(\d{3,})/);
  const stated = both ? { min: Math.min(+both[1], +both[2]), max: Math.max(+both[1], +both[2]) }
    : open ? { min: +open[1], max: Infinity }
    : single ? { min: +single[1], max: +single[1] } : null;
  if (!stated || sqft < stated.min || sqft > stated.max) return "Close to";
  const places = (req.requirement_locations || []).map(l => String(l || "").trim().toLowerCase()).filter(l => l.length > 2);
  const text = unit.property_text.toLowerCase();
  return !places.length || places.some(l => text.includes(l)) ? "Fits" : "Size fits";
}

// The order a brand's suggested pitches are shown in (Woody, 2026-11-16:
// "Jersey mikes should be suggesting everywhere but its just all of the
// available units at gunwharf"). The ranking puts every unit at a centre level
// on size and use, and the centre with the most same-format brands already
// trading wins every tie, so one centre took all six places. Taken in the
// ranking's order: the best unit at each centre, then the next best at each.
export function spreadAcrossCentres<T>(ranked: T[], centreOf: (row: T) => string): T[] {
  const rounds: T[][] = [];
  const taken = new Map<string, number>();
  for (const row of ranked) {
    const centre = centreOf(row);
    const round = taken.get(centre) ?? 0;
    taken.set(centre, round + 1);
    (rounds[round] ||= []).push(row);
  }
  return rounds.flat();
}

export const USE_HINTS: Array<[RegExp, RegExp]> = [
  [/restaurant|a1 food|f&b|caf/i, /f&b|rest|kiosk|caf|coffee|food|dining/i],
  [/gym|wellness|fitness/i, /gym|fitness|studio|wellness|health/i],
  [/leisure/i, /leisure|cinema|bowl|golf|padel/i],
  // "Coffee Shop" is F&B, not a shop for a fashion retailer.
  [/retail/i, /retail|(?<!coffee |barber |betting )shop|store/i],
];

// A unit's planning use class read as the uses a requirement names (audit,
// 2026-11-17). Units hold a class ("E(b)", "A3"), requirements a use
// ("Restaurant", "A1 Food"), so comparing the two as text kept only the
// requirements that name no use. A class lines up with the uses PIPnet's
// import and the requirement reader give it (A1 / E(a) Retail; A3 to A5 and
// E(b) Restaurant; D2 / E(d) Gym and Leisure), A1 Food goes with shops and
// food and drink as USE_HINTS has it, Sui Generis takes the old A4 and A5
// uses and cinemas, and Class E on its own covers every use. A legacy code
// is read as its 2020 class, as toUseClass in server/property-enrich.ts does.
const LEGACY_CLASSES: Record<string, string> = { a1: "e(a)", a2: "e(c)", a3: "e(b)", a4: "sg", a5: "sg", b1: "e(g)", d1: "f1", d2: "e(d)" };
const CLASS_USES: Record<string, RegExp> = {
  "e": /./,
  "e(a)": /retail|a1 food/i,
  "e(b)": /restaurant|a1 food|f&b|caf/i,
  "e(d)": /gym|fitness|wellness|leisure/i,
  "e(e)": /wellness|other/i,
  "sg": /restaurant|f&b|leisure|other/i,
};
// E(c), E(f), E(g) and the B, C and F classes.
const OTHER_USE = /other/i;

function planningClasses(text: string): string[] {
  const t = text.toLowerCase();
  const found = new Set<string>();
  for (const m of t.matchAll(/\be\s*\(\s*([a-g])\s*\)/g)) found.add(`e(${m[1]})`);
  for (const m of t.matchAll(/\b([abcd][1-9]|f\.?\s*[12])\b/g)) {
    const code = m[1].replace(/[.\s]/g, "");
    found.add(LEGACY_CLASSES[code] || code);
  }
  if (/\bsui\s*generis\b|\bsg\b/.test(t)) found.add("sg");
  // Class E on its own: an E that is not inside a word or before "(b)".
  if (/(?:^|[^a-z(])e(?![a-z0-9]|\s*\(\s*[a-g]\s*\))/.test(t)) found.add("e");
  return [...found];
}

const sameClass = (a: string, b: string) => a === b || (a === "e" && b.startsWith("e(")) || (b === "e" && a.startsWith("e("));

// Does a requirement's use line up with a unit? A side with no use stated
// fits (on size alone, where the caller checks size). Otherwise the unit's
// use class is one the requirement lists, or lines up by USE_HINTS, or its
// planning class takes one of the requirement's uses. Only the investment
// Match dialog reads this lenient form now; a leasing fit goes through
// requirementFit, whose use test (requirementUseLinesUp) needs both sides.
export function requirementUseFits(uses: readonly unknown[] | null | undefined, unit: { use_class?: string | null; unit_name?: string | null }): boolean {
  const wanted = (Array.isArray(uses) ? uses : []).map(u => String(u ?? "").trim()).filter(Boolean);
  const useClass = String(unit.use_class ?? "").trim();
  if (!wanted.length || !useClass) return true;
  if (wanted.some(w => w.toLowerCase() === useClass.toLowerCase())) return true;
  const said = wanted.join(" ");
  if (USE_HINTS.some(([reqRe, unitRe]) => reqRe.test(said) && unitRe.test(`${useClass} ${unit.unit_name || ""}`))) return true;
  const classes = planningClasses(useClass);
  return wanted.some(w => {
    const named = planningClasses(w);
    return classes.some(c => named.some(n => sameClass(c, n)) || (CLASS_USES[c] || OTHER_USE).test(w));
  });
}

// The one fit rule (Woody, 2026-11-19, decision 2 of
// docs/requirements-board-review-2026-11-19.md: "size and use or place").
// A requirement fits a unit when the unit's size sits in the requirement's
// (tolerance-widened) range AND its use lines up or it is at a place the
// requirement names. With no size to judge (the unit's or the requirement's),
// it needs both the use and the place. A use test needs a use on both sides:
// a unit with no use class fits only on its place (the requirements board
// lists those units for someone to fill in; nothing is written for them).
// Every screen that says a requirement fits a unit asks this: the board's
// Fits column and Match dialogs, the Letting Tracker's matching requirements
// and brand suggestions, Brand Gap, space fits, the target engine, suggested
// pitches and the Brand CRM's chip.

// Names too broad to place a unit by.
const VAGUE_PLACES = /^(london|greater london|central london(?: \(zone 1\))?|uk|england|nationwide|national)$/i;

// The first place the requirement names that the unit's property name or
// address holds, as the requirement spells it.
export function requirementPlaceIn(locations: readonly unknown[] | null | undefined, propertyText: string | null | undefined): string | null {
  const text = String(propertyText || "").toLowerCase();
  if (!text.trim()) return null;
  for (const raw of Array.isArray(locations) ? locations : []) {
    const place = String(raw ?? "").trim();
    if (place.length > 2 && !VAGUE_PLACES.test(place) && text.includes(place.toLowerCase())) return place;
  }
  return null;
}

// Does the unit's use line up with a use the requirement names? Both sides
// need one: the same words, USE_HINTS on the unit's class and name, or the
// unit's planning class taking one of the requirement's uses.
export function requirementUseLinesUp(uses: readonly unknown[] | null | undefined, unit: { use_class?: string | null; unit_name?: string | null }): boolean {
  const wanted = (Array.isArray(uses) ? uses : []).map(u => String(u ?? "").trim()).filter(Boolean);
  const useClass = String(unit.use_class ?? "").trim();
  const name = String(unit.unit_name ?? "").trim();
  if (!wanted.length || (!useClass && !name)) return false;
  if (useClass && wanted.some(w => w.toLowerCase() === useClass.toLowerCase())) return true;
  const said = wanted.join(" ");
  if (USE_HINTS.some(([reqRe, unitRe]) => reqRe.test(said) && unitRe.test(`${useClass} ${name}`))) return true;
  if (!useClass) return false;
  const classes = planningClasses(useClass);
  return wanted.some(w => {
    const named = planningClasses(w);
    return classes.some(c => named.some(n => sameClass(c, n)) || (CLASS_USES[c] || OTHER_USE).test(w));
  });
}

export type RequirementFit = {
  fits: boolean;
  size: "fits" | "outside" | "unknown";   // unknown: the unit or the requirement gives no size
  use: boolean;
  place: string | null;
  why: string;                             // "Size and use fit, at Bluewater"
};

export function requirementFit(
  req: { size?: string[] | string | null; use?: readonly unknown[] | null; requirement_locations?: readonly unknown[] | null },
  unit: { sqft?: number | string | null; use_class?: string | null; unit_name?: string | null; property_text: string },
): RequirementFit {
  const range = parseReqSize(req.size ?? null);
  const sqft = Number(unit.sqft) || 0;
  const size: RequirementFit["size"] = !range || !sqft ? "unknown" : sqft >= range.min && sqft <= range.max ? "fits" : "outside";
  const use = requirementUseLinesUp(req.use, unit);
  const place = requirementPlaceIn(req.requirement_locations, unit.property_text);
  const fits = size === "fits" ? use || !!place : size === "unknown" ? use && !!place : false;
  const at = place ? `, at ${place}` : "";
  const why = size === "outside" ? "Outside their size range"
    : size === "fits"
      ? (use ? `Size and use fit${at}` : place ? `Size fits${at}` : "Size fits, but neither the use nor the place lines up")
      : (use && place ? `Use fits${at}; no size to compare` : "No size to compare, and the use and place do not both line up");
  return { fits, size, use, place, why };
}

// How sure a fit is, for ordering a list of them: a size that fits counts
// twice, a use or a named place once each. Every list of fits sorts by this,
// then the smaller unit first, so the board's Fits column and its Match
// dialog put the same units first.
export function fitScore(fit: Pick<RequirementFit, "size" | "use" | "place">): number {
  return (fit.size === "fits" ? 2 : 0) + (fit.use ? 1 : 0) + (fit.place ? 1 : 0);
}

// The units a requirement is matched against on the requirements board (its
// Fits column and Match dialog): those on the market on the Letting Tracker,
// Marketing or Negotiating. A unit at Heads of Terms or Solicitors is taken.
export const FIT_POOL_STATUSES = ["AVA", "NEG"] as const;

// What a unit on the market is missing for the fit rule to judge it: a use
// class, a size, or both. The requirements board lists these units for
// someone to fill in on the Letting Tracker; nothing is written for them.
export type UnitFitGap = "use" | "size";
export function unitFitGaps(unit: { sqft?: number | string | null; use_class?: string | null }): UnitFitGap[] {
  const gaps: UnitFitGap[] = [];
  if (!String(unit.use_class ?? "").trim()) gaps.push("use");
  if (!(Number(unit.sqft) > 0)) gaps.push("size");
  return gaps;
}

// The older shape (the unit's name and use class as one text). Kept for its
// callers' tests; new code calls requirementFit with the class on its own.
export function requirementFitsUnit(req: { size?: string[] | string | null; use?: string[] | null; requirement_locations?: string[] | null },
  unit: { sqft?: number | null; unit_text: string; property_text: string }): boolean {
  return requirementFit(req, { sqft: unit.sqft, unit_name: unit.unit_text, use_class: null, property_text: unit.property_text }).fits;
}
