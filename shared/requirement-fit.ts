// Requirement ↔ unit fit rules, shared by the requirements "Fits" column
// (server/crm.ts) and the landlord Team view (server/account-teams.ts).
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

export const USE_HINTS: Array<[RegExp, RegExp]> = [
  [/restaurant|a1 food|f&b|caf/i, /f&b|rest|kiosk|caf|coffee|food|dining/i],
  [/gym|wellness|fitness/i, /gym|fitness|studio|wellness|health/i],
  [/leisure/i, /leisure|cinema|bowl|golf|padel/i],
  // "Coffee Shop" is F&B, not a shop for a fashion retailer.
  [/retail/i, /retail|(?<!coffee |barber |betting )shop|store/i],
];

// A live leasing requirement fits a unit when the unit's size sits in the
// requirement's range and its use or location lines up too; a unit with no
// recorded size needs both. Same rules as the requirements "Fits" column.
export function requirementFitsUnit(req: { size?: string[] | string | null; use?: string[] | null; requirement_locations?: string[] | null },
  unit: { sqft?: number | null; unit_text: string; property_text: string }): boolean {
  const range = parseReqSize(req.size ?? null);
  const uses = (req.use || []).join(" ");
  const useHint = !!uses && USE_HINTS.some(([reqRe, unitRe]) => reqRe.test(uses) && unitRe.test(unit.unit_text));
  const locs = (req.requirement_locations || []).map(l => String(l || "").toLowerCase())
    .filter(l => l.length > 2 && !/^(london|greater london|central london \(zone 1\))$/i.test(l));
  const text = unit.property_text.toLowerCase();
  const locationHit = locs.some(l => text.includes(l));
  const sqft = Number(unit.sqft) || 0;
  if (sqft) return !!range && sqft >= range.min && sqft <= range.max && (useHint || locationHit);
  return useHint && locationHit;
}
