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

// Geography is coarse for investment buyers (Woody, 2026-09-27: "more use
// focused than geographical — at most it's London and then national, and
// then it's thematic and use based investment approaches"). So: London or
// national only, no town matching.
const LONDON_RE = /\b(london|m25|crossrail|zone 1|west end|city of london|docklands)\b/i;
const NATIONAL_RE = /\b(national(ly)?|nationwide|uk[- ]wide|regional(ly)?|regions|across the uk|uk)\b/i;
export function locationsIn(text: string | null | undefined): { london: boolean; national: boolean } {
  const t = String(text || "");
  return { london: LONDON_RE.test(t), national: NATIONAL_RE.test(t) };
}

export function assetIsLondon(address: string | null | undefined): boolean {
  const a = String(address || "");
  return /\blondon\b/i.test(a) || /\b(E|EC|N|NW|SE|SW|W|WC)\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i.test(a);
}

// The detail of the use — what a thematic buyer actually targets.
const USE_DETAILS: Array<[string, RegExp]> = [
  ["shopping centres", /\b(shopping cent(re|er)s?|malls?)\b/i],
  ["retail parks", /\b(retail parks?|retail warehous(e|ing))\b/i],
  ["supermarkets", /\b(supermarkets?|food ?stores?|grocery|grocers?)\b/i],
  ["high street", /\b(high streets?|prime retail|parades?|shops)\b/i],
  ["leisure parks", /\b(leisure parks?|leisure schemes?)\b/i],
  ["outlets", /\b(outlets?|outlet cent(re|er)s?)\b/i],
  ["F&B", /\b(f&b|restaurants?|food (and|&) beverage|food halls?|markets?)\b/i],
  ["logistics", /\b(logistics|last mile|distribution|parcel hubs?|big box)\b/i],
];
export function useDetailsIn(text: string | null | undefined): string[] {
  const t = String(text || "");
  return USE_DETAILS.filter(([, re]) => re.test(t)).map(([u]) => u);
}

// Investment approaches — read from a buyer's notes, and from the asset's
// own numbers (WAULT, occupancy, capex) and description.
export type Approach = "long income" | "core" | "core-plus" | "value-add" | "opportunistic" | "development";
const APPROACH_WORDS: Array<[Approach, RegExp]> = [
  ["long income", /\b(long income|secure income|long[- ]dated|annuity|index[- ]linked|ground rents?)\b/i],
  ["core-plus", /\b(core[- ]?plus|core\+)/i],
  ["core", /\bcore\b(?![- ]?plus|\+)/i],
  ["value-add", /\b(value[- ]add|repositioning|asset management|refurb(ishment)?|turnaround|active management)\b/i],
  ["opportunistic", /\b(opportunistic|distress(ed)?|stressed|special situations|receivership|administration)\b/i],
  ["development", /\b(development|redevelopment|land|planning|consented)\b/i],
];
export function approachesIn(text: string | null | undefined): Approach[] {
  const t = String(text || "");
  return APPROACH_WORDS.filter(([, re]) => re.test(t)).map(([a]) => a);
}

export interface AssetProfile { classes: AssetClass[]; uses: string[]; approaches: Approach[]; guidePrice: number | null; london: boolean }

export function assetProfile(a: { assetType?: string | null; name?: string | null; notes?: string | null; assetClass?: string | null;
  address?: string | null; guidePrice?: number | null; waultBreak?: number | null; waultExpiry?: number | null; occupancy?: number | null; capex?: number | null }): AssetProfile {
  const text = [a.assetType, a.name, a.notes, a.assetClass].filter(Boolean).join(" ");
  const approaches = new Set<Approach>(approachesIn(text));
  const wault = Number(a.waultExpiry ?? a.waultBreak) || null;
  const occ = a.occupancy != null ? Number(a.occupancy) : null;
  if (wault != null && wault >= 12) approaches.add("long income");
  if (occ != null && occ >= 95 && wault != null && wault >= 5) approaches.add("core");
  if (occ != null && occ >= 85 && wault != null && wault >= 3 && wault < 8) approaches.add("core-plus");
  if ((occ != null && occ < 85) || (Number(a.capex) || 0) > 0 || (wault != null && wault < 3)) approaches.add("value-add");
  return {
    classes: assetClassesIn(text),
    uses: useDetailsIn(text),
    approaches: [...approaches],
    guidePrice: Number(a.guidePrice) || null,
    london: assetIsLondon(a.address),
  };
}

export interface BuyerFit { score: number; reasons: string[]; classHit: boolean }

// Score one buyer's criteria text against a sale: use first (asset class,
// then the detail of the use), then investment approach, then lot size,
// then coarse geography (London / national).
export function criteriaFit(criteria: string, asset: AssetProfile): BuyerFit {
  const reasons: string[] = [];
  let score = 0;
  const wants = assetClassesIn(criteria);
  const classHit = asset.classes.find(c => wants.includes(c));
  if (classHit) { score += 4; reasons.push(`buys ${classHit}`); }
  else if (wants.length && asset.classes.length) score -= 4;
  const wantUses = useDetailsIn(criteria);
  const useHits = asset.uses.filter(u => wantUses.includes(u));
  if (useHits.length) { score += Math.min(useHits.length, 2) * 2; reasons.push(useHits.join(", ")); }
  else if (wantUses.length && asset.uses.length) score -= 1;
  const wantApproach = approachesIn(criteria);
  const approachHits = asset.approaches.filter(a => wantApproach.includes(a));
  if (approachHits.length) { score += Math.min(approachHits.length, 2) * 2; reasons.push(approachHits.join(", ")); }
  const lot = lotSizeIn(criteria);
  if (lot && asset.guidePrice) {
    const inLot = (lot.min == null || asset.guidePrice >= lot.min * 0.8) && (lot.max == null || asset.guidePrice <= lot.max * 1.25);
    const fmt = (v: number | null) => v == null ? "" : v >= 1e9 ? `£${v / 1e9}bn` : `£${Math.round(v / 1e6)}m`;
    if (inLot) { score += 2; reasons.push(`lot size ${fmt(lot.min)}${lot.max ? `–${fmt(lot.max)}` : "+"}`); }
    else score -= 2;
  }
  const where = locationsIn(criteria);
  if (asset.london && where.london) { score += 1; reasons.push("London"); }
  else if (where.national) { score += 1; reasons.push("national"); }
  else if (where.london && !asset.london) score -= 2;
  return { score, reasons, classHit: !!classHit };
}
