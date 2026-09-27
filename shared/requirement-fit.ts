// Requirement ↔ unit fit rules, shared by the requirements "Fits" column
// (server/crm.ts) and the landlord Team view (server/account-teams.ts).
// A requirement's size text ("1,500-3,000 sq ft", "2000+", "4000") becomes a
// tolerance-widened range; use hints pair requirement uses with unit names /
// use classes.
export const parseReqSize = (size: string[] | string | null): { min: number; max: number } | null => {
  const raw = (Array.isArray(size) ? size.join(" ") : size || "").replace(/,/g, "");
  const range = raw.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return { min: +range[1] * 0.8, max: +range[2] * 1.2 };
  const open = raw.match(/(\d+)\s*-/);
  if (open) return { min: +open[1] * 0.8, max: +open[1] * 5 };
  const single = raw.match(/(\d{3,})/);
  if (single) return { min: +single[1] * 0.6, max: +single[1] * 1.6 };
  return null;
};

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
