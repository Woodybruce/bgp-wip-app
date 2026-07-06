/**
 * Retail taxonomy for the BGP Goad-style plan.
 *
 * Two jobs:
 *   1) Bucket a unit into a category from whatever signal we have (brand
 *      name OR VOA description code OR Google Places type).
 *   2) Hand the renderer a colour for that category.
 *
 * Keep categories broad and clean — six groups is the sweet spot for a
 * readable plan. Goad itself uses about 12; our users read these at
 * glance speed and six will already feel richer than a pin map.
 */

export type RetailCategory =
  | "fashion"        // Comparison retail: fashion, jewellery, electronics, homeware
  | "convenience"    // Food & drink retail, grocers, off-licences, pharmacies
  | "fnb"            // Restaurants, cafes, pubs, takeaways, bars
  | "services"       // Banks, estate agents, solicitors, post offices, travel
  | "beauty"         // Hair, nails, barbers, spas, dry cleaners, tailors
  | "vacant"         // Confirmed or likely vacant
  | "other";         // Anything else / unknown use

export interface CategoryStyle {
  fill: string;          // polygon fill colour
  stroke: string;        // polygon stroke colour
  label: string;         // human-readable label for the legend
  textColor: string;     // text colour that reads on the fill
}

/**
 * Clean, simple palette — BGP slate + Claude-orange accents, desaturated
 * greens/teals so the map doesn't look like a pride flag. Vacant units
 * are deliberately visible (claude-orange) because vacancy is the signal
 * users care about most.
 */
export const CATEGORY_STYLES: Record<RetailCategory, CategoryStyle> = {
  fashion:     { fill: "#C9A961", stroke: "#8A7237", label: "Fashion & Comparison", textColor: "#1F1F1F" },
  convenience: { fill: "#7FA99B", stroke: "#4F7064", label: "Convenience & Food Retail", textColor: "#1F1F1F" },
  fnb:         { fill: "#C17A5F", stroke: "#7F4A32", label: "Food & Beverage", textColor: "#FFFFFF" },
  services:    { fill: "#8FA4B8", stroke: "#556877", label: "Services", textColor: "#1F1F1F" },
  beauty:      { fill: "#B89CB3", stroke: "#7A5F75", label: "Health & Beauty", textColor: "#1F1F1F" },
  vacant:      { fill: "#F4E4D7", stroke: "#D97757", label: "Vacant / Likely Vacant", textColor: "#7A3E2C" },
  other:       { fill: "#D6D6D3", stroke: "#9A9A95", label: "Other", textColor: "#3F3F3F" },
};

// Subject red-line + neutral building base.
export const PLAN_COLORS = {
  subjectLine: "#D62828",       // red-line stroke for the subject property
  subjectFill: "rgba(214, 40, 40, 0.08)",
  buildingBase: "#E8E6E1",      // neutral biscuit for un-classified buildings
  buildingStroke: "#B8B5AE",
  roadFill: "#FFFFFF",
  roadStroke: "#CDCAC2",
  pageBg: "#FAF8F3",            // warm paper background (Claude-ish)
  ink: "#1F1F1F",
  inkMuted: "#6A655A",
  accent: "#D97757",            // Claude orange — used for subject callout and "new let" badges
};

/**
 * Curated UK high-street brand → category dictionary. Top names only —
 * unknown brands fall back to the VOA-description matcher below.
 *
 * Keys are lower-cased; we compare against a normalised tenant string.
 */
const BRAND_DICTIONARY: Record<string, RetailCategory> = {
  // Fashion & comparison
  "zara": "fashion", "h&m": "fashion", "uniqlo": "fashion", "primark": "fashion",
  "next": "fashion", "john lewis": "fashion", "selfridges": "fashion", "harrods": "fashion",
  "m&s": "fashion", "marks & spencer": "fashion", "marks and spencer": "fashion",
  "zara home": "fashion", "massimo dutti": "fashion", "pull & bear": "fashion", "bershka": "fashion",
  "stradivarius": "fashion", "mango": "fashion", "cos": "fashion", "arket": "fashion",
  "reiss": "fashion", "hobbs": "fashion", "lk bennett": "fashion", "whistles": "fashion",
  "ted baker": "fashion", "hugo boss": "fashion", "tommy hilfiger": "fashion", "gap": "fashion",
  "levi's": "fashion", "levis": "fashion", "adidas": "fashion", "nike": "fashion", "puma": "fashion",
  "jd sports": "fashion", "sports direct": "fashion", "foot locker": "fashion", "size?": "fashion",
  "schuh": "fashion", "clarks": "fashion", "office": "fashion", "russell & bromley": "fashion",
  "kurt geiger": "fashion", "pandora": "fashion", "swarovski": "fashion", "goldsmiths": "fashion",
  "ernest jones": "fashion", "h samuel": "fashion", "watches of switzerland": "fashion",
  "rolex": "fashion", "omega": "fashion", "cartier": "fashion", "tiffany & co": "fashion",
  "apple": "fashion", "samsung": "fashion", "currys": "fashion", "pc world": "fashion",
  "argos": "fashion", "ee": "fashion", "o2": "fashion", "vodafone": "fashion", "three": "fashion",
  "the white company": "fashion", "oliver bonas": "fashion", "anthropologie": "fashion",
  "& other stories": "fashion", "urban outfitters": "fashion", "weekday": "fashion",
  "lululemon": "fashion", "sweaty betty": "fashion", "gymshark": "fashion",
  "victoria's secret": "fashion", "lovisa": "fashion", "monki": "fashion",
  "zara kids": "fashion", "superdrug": "beauty", "boots": "beauty",

  // Convenience & food retail
  "tesco": "convenience", "sainsbury's": "convenience", "sainsburys": "convenience",
  "co-op": "convenience", "coop": "convenience", "the co-op": "convenience",
  "asda": "convenience", "morrisons": "convenience", "waitrose": "convenience",
  "lidl": "convenience", "aldi": "convenience", "iceland": "convenience", "food warehouse": "convenience",
  "marks & spencer food": "convenience", "m&s food": "convenience",
  "little waitrose": "convenience", "tesco express": "convenience", "sainsbury's local": "convenience",
  "holland & barrett": "convenience", "whole foods": "convenience", "planet organic": "convenience",
  "spar": "convenience", "costcutter": "convenience", "nisa": "convenience", "one stop": "convenience",

  // F&B
  "pret": "fnb", "pret a manger": "fnb", "pret-a-manger": "fnb",
  "starbucks": "fnb", "costa": "fnb", "costa coffee": "fnb", "caffè nero": "fnb", "caffe nero": "fnb",
  "nero": "fnb", "joe & the juice": "fnb", "gail's": "fnb", "gails": "fnb", "gail's bakery": "fnb",
  "leon": "fnb", "itsu": "fnb", "wasabi": "fnb", "yo!": "fnb", "yo sushi": "fnb",
  "nando's": "fnb", "nandos": "fnb", "wagamama": "fnb", "five guys": "fnb",
  "mcdonald's": "fnb", "mcdonalds": "fnb", "burger king": "fnb", "kfc": "fnb",
  "subway": "fnb", "gregg's": "fnb", "greggs": "fnb", "dominos": "fnb", "domino's": "fnb",
  "pizza express": "fnb", "pizzaexpress": "fnb", "pizza hut": "fnb", "papa john's": "fnb",
  "franco manca": "fnb", "honest burgers": "fnb", "byron": "fnb", "shake shack": "fnb",
  "wahaca": "fnb", "chipotle": "fnb", "taco bell": "fnb",
  "dishoom": "fnb", "hawksmoor": "fnb", "the ivy": "fnb", "côte": "fnb", "cote": "fnb",
  "cafe rouge": "fnb", "carluccio's": "fnb", "carluccios": "fnb", "bill's": "fnb", "bills": "fnb",
  "prezzo": "fnb", "zizzi": "fnb", "ask italian": "fnb",
  "wetherspoon": "fnb", "jd wetherspoon": "fnb", "the slug and lettuce": "fnb",
  "all bar one": "fnb", "be at one": "fnb", "revolution": "fnb",
  "tortilla": "fnb", "crussh": "fnb", "pod": "fnb",

  // Services
  "barclays": "services", "hsbc": "services", "natwest": "services", "lloyds": "services",
  "lloyds bank": "services", "halifax": "services", "santander": "services",
  "monzo": "services", "starling": "services", "metro bank": "services",
  "post office": "services", "royal mail": "services", "dhl": "services", "fedex": "services",
  "foxtons": "services", "savills": "services", "knight frank": "services", "carter jonas": "services",
  "winkworth": "services", "hamptons": "services", "chestertons": "services",
  "dentons": "services", "cbre": "services", "jll": "services", "cushman & wakefield": "services",
  "colliers": "services", "avison young": "services",
  "bruce gillingham pollard": "services", "bgp": "services",
  "specsavers": "services", "vision express": "services", "boots opticians": "services",

  // Beauty
  "lush": "beauty", "the body shop": "beauty", "body shop": "beauty", "rituals": "beauty",
  "l'occitane": "beauty", "loccitane": "beauty", "jo malone": "beauty", "charlotte tilbury": "beauty",
  "mac": "beauty", "mac cosmetics": "beauty", "kiehl's": "beauty", "aesop": "beauty",
  "space nk": "beauty", "sephora": "beauty",
  "timpson": "services", "johnsons cleaners": "beauty", "jeeves": "beauty",
};

function normaliseBrand(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9& ]+/g, "").replace(/\s+/g, " ").trim();
}

export function categoriseFromBrand(brand: string | null | undefined): RetailCategory | null {
  if (!brand) return null;
  const n = normaliseBrand(brand);
  if (!n) return null;
  if (BRAND_DICTIONARY[n]) return BRAND_DICTIONARY[n];
  // Try longest prefix match so "Pret a Manger Ltd" resolves as "Pret a Manger"
  for (const key of Object.keys(BRAND_DICTIONARY)) {
    if (n.startsWith(key + " ") || n.includes(" " + key + " ") || n.endsWith(" " + key)) {
      return BRAND_DICTIONARY[key];
    }
  }
  return null;
}

/**
 * Fall-back classification from a VOA description. Description codes are
 * inconsistent so we work from the *text* rather than the code.
 */
export function categoriseFromVoaDescription(desc: string | null | undefined): RetailCategory {
  const s = (desc || "").toLowerCase();
  if (!s) return "other";
  if (/empty|void|vacant/.test(s)) return "vacant";
  if (/shop|store|retail/.test(s)) {
    // Try sub-classify: food-retail keywords → convenience
    if (/supermarket|grocer|butcher|baker(?!y)|off.?licence|pharmac/.test(s)) return "convenience";
    // Hair/beauty retail
    if (/hair|beauty|salon|barber/.test(s)) return "beauty";
    return "fashion";
  }
  if (/restaurant|cafe|coffee|pub(lic house)?|bar(?! and)|takeaway|food.?court|bistro/.test(s)) return "fnb";
  if (/bank|buildings? society|post office|estate agent|letting|travel|solicitor|estate|betting/.test(s)) return "services";
  if (/hair|beauty|salon|barber|nail|spa/.test(s)) return "beauty";
  if (/supermarket|grocer|convenience store|off.?licence|pharmac/.test(s)) return "convenience";
  if (/warehouse|industrial|office|workshop/.test(s)) return "other";
  return "other";
}

/**
 * Google Places type can override — "bakery", "bar", "restaurant" etc.
 * Only called when we don't have a brand hit. Returns null if nothing
 * useful (renderer should then fall back to VOA description).
 */
export function categoriseFromPlaceTypes(types: string[] | null | undefined): RetailCategory | null {
  if (!types || types.length === 0) return null;
  const set = new Set(types.map((t) => t.toLowerCase()));
  if (set.has("restaurant") || set.has("cafe") || set.has("bar") || set.has("bakery") || set.has("meal_takeaway") || set.has("meal_delivery") || set.has("night_club")) return "fnb";
  if (set.has("supermarket") || set.has("grocery_or_supermarket") || set.has("convenience_store") || set.has("liquor_store") || set.has("pharmacy")) return "convenience";
  if (set.has("clothing_store") || set.has("shoe_store") || set.has("jewelry_store") || set.has("electronics_store") || set.has("furniture_store") || set.has("home_goods_store") || set.has("book_store") || set.has("department_store")) return "fashion";
  if (set.has("hair_care") || set.has("beauty_salon") || set.has("spa") || set.has("laundry")) return "beauty";
  if (set.has("bank") || set.has("atm") || set.has("real_estate_agency") || set.has("lawyer") || set.has("accounting") || set.has("post_office") || set.has("travel_agency") || set.has("insurance_agency")) return "services";
  if (set.has("store") || set.has("shopping_mall")) return "fashion";
  return null;
}

/**
 * Final resolver — takes whatever we know about a unit and returns its
 * category + style. Priority: brand > place types > VOA description.
 * `isConfirmedVacant` wins over everything else.
 */
export function resolveUnitCategory(opts: {
  brand?: string | null;
  voaDescription?: string | null;
  placeTypes?: string[] | null;
  isConfirmedVacant?: boolean;
  isLikelyVacant?: boolean;
}): RetailCategory {
  if (opts.isConfirmedVacant) return "vacant";
  const byBrand = categoriseFromBrand(opts.brand);
  if (byBrand) return byBrand;
  const byPlaces = categoriseFromPlaceTypes(opts.placeTypes);
  if (byPlaces) return byPlaces;
  const byVoa = categoriseFromVoaDescription(opts.voaDescription);
  if (byVoa === "vacant") return "vacant";
  if (opts.isLikelyVacant) return "vacant";
  return byVoa;
}

/**
 * Short human label for the "use class" line printed under the tenant
 * name. Kept tight (<= ~14 chars) so it fits inside small polygons.
 */
export function shortUseLabel(category: RetailCategory): string {
  switch (category) {
    case "fashion": return "Retail";
    case "convenience": return "Convenience";
    case "fnb": return "F&B";
    case "services": return "Services";
    case "beauty": return "Health & Beauty";
    case "vacant": return "Vacant";
    case "other": return "Other";
  }
}
