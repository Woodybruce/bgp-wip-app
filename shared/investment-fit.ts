// Which buyers fit an investment sale (Woody, 2026-09-26/27: "Fits buyers"
// on the Sales board). Investment requirements in the CRM are a buyer list
// whose criteria live in free-text notes ("Commercial, hotel. £5-£25mn. M25
// or crossrail", "Lot size: £3-15m+"), so the criteria are read from the
// text: asset classes, lot size and locations. Deterministic and explained —
// every match says why.

export type AssetClass = "retail" | "office" | "hotel" | "industrial" | "leisure" | "residential" | "mixed" | "alternatives";

const CLASS_WORDS: Array<[AssetClass, RegExp]> = [
  ["retail", /\b(retail|shopping|high street|supermarket|foodstore|retail park|outlet)s?\b/i],
  ["office", /\b(office|offices|workspace)\b/i],
  ["hotel", /\b(hotel|hotels|hospitality|serviced apartment)s?\b/i],
  ["industrial", /\b(industrial|logistics|distribution|warehouse|last mile|parcel hub|urban logistics)s?\b/i],
  ["leisure", /\b(leisure|cinema|gym|f&b|restaurant|pub)s?\b/i],
  ["residential", /\b(residential|btr|build to rent|pbsa|student|single family|living|affordable)\b/i],
  ["mixed", /\b(mixed[- ]use|mixed use)\b/i],
  ["alternatives", /\b(alternatives?|healthcare|data cent(re|er)s?|self storage|life science)\b/i],
];

export function assetClassesIn(text: string | null | undefined): AssetClass[] {
  const t = String(text || "");
  return CLASS_WORDS.filter(([, re]) => re.test(t)).map(([c]) => c);
}

// The asset's own class, from its type label ("Retail", "Leisure", …).
export function assetClassOf(assetType: string | null | undefined, name?: string | null): AssetClass[] {
  const found = assetClassesIn(`${assetType || ""} ${name || ""}`);
  return found.length ? found : [];
}

const unit = (u: string | undefined) => {
  const v = (u || "m").toLowerCase();
  if (v.startsWith("b")) return 1_000_000_000;
  if (v === "k") return 1_000;
  return 1_000_000;
};

// Lot size in £ from text: "£5-£25mn", "£15m to £100m", "£3-15m+", "up to £50m", "£10m+".
export function lotSizeIn(text: string | null | undefined): { min: number | null; max: number | null } | null {
  const t = String(text || "").replace(/,/g, "");
  const range = t.match(/£\s?(\d+(?:\.\d+)?)\s*(bn|b|m|mn|million|k)?\s*(?:-|–|to)\s*£?\s?(\d+(?:\.\d+)?)\s*(bn|b|m|mn|million|k)?(\+)?/i);
  if (range) {
    const hiUnit = unit(range[4] || range[2]);
    const loUnit = range[2] ? unit(range[2]) : hiUnit;
    return { min: +range[1] * loUnit, max: range[5] ? null : +range[3] * hiUnit };
  }
  const upTo = t.match(/up to\s*£\s?(\d+(?:\.\d+)?)\s*(bn|b|m|mn|million|k)?/i);
  if (upTo) return { min: null, max: +upTo[1] * unit(upTo[2]) };
  const plus = t.match(/£\s?(\d+(?:\.\d+)?)\s*(bn|b|m|mn|million|k)?\s*\+/i);
  if (plus) return { min: +plus[1] * unit(plus[2]), max: null };
  return null;
}

// Place words the matcher recognises; "London" also covers "M25" / "Crossrail"
// / "Central London"; "Regional" covers any UK town outside London.
const LONDON_RE = /\b(london|m25|crossrail|zone 1|west end|city of london|docklands)\b/i;
export function locationsIn(text: string | null | undefined): { london: boolean; regional: boolean; places: string[] } {
  const t = String(text || "");
  const places = (t.match(/\b(manchester|birmingham|leeds|bristol|edinburgh|glasgow|cardiff|liverpool|newcastle|sheffield|nottingham|oxford|cambridge|brighton|southampton|portsmouth|reading|milton keynes|sunderland|aberdeen|belfast)\b/gi) || [])
    .map(p => p.toLowerCase());
  return { london: LONDON_RE.test(t), regional: /\b(regional|regions|uk wide|nationwide|national)\b/i.test(t), places: [...new Set(places)] };
}

export function assetIsLondon(address: string | null | undefined): boolean {
  const a = String(address || "");
  return /\blondon\b/i.test(a) || /\b(E|EC|N|NW|SE|SW|W|WC)\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i.test(a);
}

export interface BuyerFit { score: number; reasons: string[] }

// Score one buyer's criteria text against a sale asset.
export function criteriaFit(criteria: string, asset: { classes: AssetClass[]; guidePrice: number | null; address: string | null }): BuyerFit {
  const reasons: string[] = [];
  let score = 0;
  const wants = assetClassesIn(criteria);
  const classHit = asset.classes.find(c => wants.includes(c));
  if (classHit) { score += 3; reasons.push(`buys ${classHit}`); }
  else if (wants.length && asset.classes.length) { score -= 2; }
  const lot = lotSizeIn(criteria);
  if (lot && asset.guidePrice) {
    const inLot = (lot.min == null || asset.guidePrice >= lot.min * 0.8) && (lot.max == null || asset.guidePrice <= lot.max * 1.25);
    const fmt = (v: number | null) => v == null ? "" : v >= 1e9 ? `£${v / 1e9}bn` : `£${Math.round(v / 1e6)}m`;
    if (inLot) { score += 3; reasons.push(`lot size ${fmt(lot.min)}${lot.max ? `–${fmt(lot.max)}` : "+"}`); }
    else score -= 2;
  }
  const where = locationsIn(criteria);
  const london = assetIsLondon(asset.address);
  const addr = String(asset.address || "").toLowerCase();
  if (london && where.london) { score += 2; reasons.push("London"); }
  else if (!london && where.places.some(p => addr.includes(p))) { score += 2; reasons.push(where.places.find(p => addr.includes(p))!.replace(/^\w/, c => c.toUpperCase())); }
  else if (!london && where.regional) { score += 1; reasons.push("regional"); }
  else if (where.london && !london && !where.regional) { score -= 1; }
  return { score, reasons };
}
