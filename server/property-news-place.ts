// A story only counts for a property when it's about THAT place. "Royal
// Exchange" is the City of London arcade BGP lets and also Manchester's
// theatre; the property page was filling with King Lear rehearsals and a
// Britannica entry (Woody, 2026-09-28: "What a mess"). Pure helpers so the
// property News Feed and the "New brands going in" list share one rule.
import { haversineKm } from "../shared/uk-centres";

export interface PlaceContext {
  // Property name first, then its aliases ("Royal Exchange", "The Royal Exchange").
  names: string[];
  // Where it is and who owns it: town, street, area, postcode district, owner.
  anchors: string[];
  lat?: number | null;
  lng?: number | null;
}

// Towns and cities that host a same-named building elsewhere, with rough
// coordinates so a town near the property (Dartford for Bluewater) is home.
// Ordinary-word towns (Sale, Reading, Bath, Wells, Halifax…) are left out —
// "Royal Exchange sale" is not a place.
const TOWNS: Array<[string, number, number]> = [
  ["london", 51.507, -0.128], ["manchester", 53.48, -2.242], ["birmingham", 52.486, -1.89], ["leeds", 53.801, -1.549],
  ["liverpool", 53.408, -2.991], ["glasgow", 55.864, -4.252], ["edinburgh", 55.953, -3.189], ["bristol", 51.455, -2.588],
  ["cardiff", 51.481, -3.179], ["belfast", 54.597, -5.93], ["newcastle", 54.978, -1.618], ["sheffield", 53.381, -1.47],
  ["nottingham", 52.954, -1.158], ["leicester", 52.637, -1.14], ["southampton", 50.91, -1.404], ["portsmouth", 50.819, -1.088],
  ["brighton", 50.823, -0.137], ["oxford", 51.752, -1.258], ["cambridge", 52.205, 0.122], ["york", 53.96, -1.082],
  ["hull", 53.745, -0.336], ["coventry", 52.407, -1.512], ["wolverhampton", 52.587, -2.129], ["derby", 52.922, -1.477],
  ["plymouth", 50.376, -4.143], ["exeter", 50.718, -3.534], ["norwich", 52.63, 1.297], ["ipswich", 52.057, 1.148],
  ["aberdeen", 57.149, -2.094], ["dundee", 56.462, -2.971], ["inverness", 57.478, -4.225], ["stirling", 56.117, -3.937],
  ["swansea", 51.621, -3.944], ["newport", 51.588, -2.998], ["preston", 53.763, -2.703], ["blackburn", 53.748, -2.482],
  ["blackpool", 53.817, -3.036], ["bolton", 53.578, -2.429], ["wigan", 53.545, -2.632], ["stockport", 53.408, -2.149],
  ["oldham", 53.541, -2.118], ["rochdale", 53.615, -2.155], ["bradford", 53.795, -1.759], ["huddersfield", 53.646, -1.78],
  ["wakefield", 53.683, -1.498], ["doncaster", 53.523, -1.133], ["barnsley", 53.553, -1.483], ["rotherham", 53.43, -1.357],
  ["sunderland", 54.906, -1.381], ["middlesbrough", 54.574, -1.235], ["durham", 54.776, -1.575], ["carlisle", 54.892, -2.934],
  ["lancaster", 54.047, -2.801], ["chester", 53.193, -2.893], ["shrewsbury", 52.708, -2.754], ["worcester", 52.192, -2.22],
  ["gloucester", 51.864, -2.238], ["cheltenham", 51.899, -2.078], ["swindon", 51.558, -1.782], ["bournemouth", 50.72, -1.88],
  ["salisbury", 51.069, -1.795], ["winchester", 51.063, -1.308], ["guildford", 51.236, -0.57], ["maidstone", 51.272, 0.529],
  ["canterbury", 51.28, 1.079], ["chelmsford", 51.736, 0.469], ["colchester", 51.889, 0.901], ["southend", 51.546, 0.708],
  ["luton", 51.879, -0.418], ["northampton", 52.24, -0.903], ["milton keynes", 52.04, -0.759], ["peterborough", 52.573, -0.241],
  ["lincoln", 53.23, -0.54], ["watford", 51.656, -0.39], ["dublin", 53.35, -6.26], ["paris", 48.857, 2.352],
  ["amsterdam", 52.37, 4.895], ["new york", 40.713, -74.006], ["toronto", 43.653, -79.383], ["sydney", -33.869, 151.209],
  ["melbourne", -37.814, 144.963], ["hong kong", 22.319, 114.169], ["singapore", 1.352, 103.82], ["dubai", 25.205, 55.271],
];
const HOME_KM = 40;

// Words that make up building names shared between towns — "Royal Exchange",
// "Corn Exchange", "The Arcade", "Grand Central", "Castle Quarter".
const SHARED_NAME_WORDS = new Set(["royal", "exchange", "corn", "arcade", "arcades", "market", "markets", "victoria", "grand",
  "central", "city", "town", "hall", "crown", "church", "castle", "cathedral", "abbey", "king", "kings", "queen", "queens",
  "prince", "princes", "princess", "guildhall", "union", "commercial", "merchant", "merchants", "old", "new", "high",
  "cross", "gate", "gates", "bridge", "station", "mill", "mills", "hill", "north", "south", "east", "west", "st", "saint",
  "george", "georges", "james", "john", "johns", "mary", "marys", "peter", "peters", "albert", "albion", "empire", "regent",
  "metropolitan", "civic", "county", "national", "imperial", "palace", "galleries", "gallery", "mall", "precinct",
  "wharf", "quay", "quays", "harbour", "dock", "docks", "riverside", "waterfront", "one", "two"]);
const GENERIC = new Set(["the", "and", "of", "shopping", "centre", "center", "retail", "park", "house", "estate", "street",
  "road", "square", "place", "court", "plaza", "tower", "building", "quarter", "gardens", "yard", "unit", "units"]);
// A same-named venue of a different kind: "the Royal Exchange Theatre".
const VENUE = /^\s+(theatre|theater|church|cathedral|station|stadium|school|college|university|hospital|museum|fc|football club)\b/;
// Reference pages, not news: Britannica, Wikipedia and their mirrors.
const REFERENCE = /\b(?:britannica|wikipedia|wikiwand|wikivoyage|wikitravel|fandom|dbpedia|encyclopedia|encyclopaedia)\b/i;
// Property and retail news — what BGP reads a shared-name story for. Kept to
// words a theatre listing doesn't use ("tickets on sale", "box office").
const PROPERTY_CONTEXT = /\b(?:stores?|shops?|boutiques?|flagship|restaurants?|retailers?|retail|tenants?|landlords?|leases?|leasing|lettings?|let to|rents?|rental|for sale|sale of|sold to|acquir\w*|acquisitions?|investors?|investment|refurbish\w*|redevelop\w*|developments?|planning|occupiers?|units?|brands?|arcade|shopping|dining|(?<!box )offices?|ownership|new owners?)\b|£\s?\d/i;

const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (value: string) => ` ${String(value || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ")} `;
const words = (value: string) => norm(value).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

// "The Royal Exchange, Bank" → "royal exchange" — the building, not the place.
export function coreName(name: string): string {
  const head = String(name || "").split(",")[0];
  return norm(head).replace(/[^a-z0-9'&\s]/g, " ").replace(/^\s*the\s+/, "").replace(/\s+/g, " ").trim();
}

// A name made only of civic / ordinary words is one another town can have too.
export function isSharedName(name: string): boolean {
  const tokens = words(coreName(name)).filter(w => !GENERIC.has(w) && !/^\d+[a-z]?$/.test(w));
  return tokens.length > 0 && tokens.every(w => SHARED_NAME_WORDS.has(w));
}

export function isReferencePage(article: { url?: string | null; sourceName?: string | null; source?: string | null; title?: string | null }): boolean {
  let host = "";
  try { host = new URL(String(article.url || "")).hostname; } catch {}
  return REFERENCE.test(`${article.sourceName || ""} ${article.source || ""} ${host.replace(/\./g, " ")}`);
}

function homeTown(town: string, ctx: PlaceContext): boolean {
  const own = norm([...ctx.names, ...ctx.anchors].join(" | "));
  if (new RegExp(`[^a-z0-9]${esc(town)}[^a-z0-9]`).test(own)) return true;
  const entry = TOWNS.find(t => t[0] === town);
  const lat = Number(ctx.lat), lng = Number(ctx.lng);
  return !!entry && Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
    && haversineKm(lat, lng, entry[1], entry[2]) <= HOME_KM;
}

// True when the text puts this building's name somewhere else: "Manchester's
// Royal Exchange", "Royal Exchange, Manchester", "the Royal Exchange Theatre".
export function namesElsewhere(text: string, ctx: PlaceContext): boolean {
  const t = norm(text);
  const variants = Array.from(new Set(ctx.names.map(coreName).filter(n => n.length > 3)));
  const away = TOWNS.map(e => e[0]).filter(town => t.includes(town) && !homeTown(town, ctx));
  for (const n of variants) {
    const N = esc(n);
    for (const m of Array.from(t.matchAll(new RegExp(`[^a-z0-9]${N}(?=[^a-z0-9])`, "g")))) {
      const venue = VENUE.exec(t.slice((m.index ?? 0) + m[0].length).replace(/^'s\b/, ""));
      if (venue && !n.includes(venue[1])) return true;
    }
    for (const town of away) {
      const T = esc(town);
      if (new RegExp(`[^a-z0-9]${T}(?:'s?)?\\s+(?:the\\s+)?${N}[^a-z0-9]`).test(t)) return true;
      if (new RegExp(`[^a-z0-9]${N}(?:\\s*,|\\s*\\(|\\s+in)\\s*(?:the\\s+)?(?:city of\\s+)?${T}[^a-z0-9]`).test(t)) return true;
      if (new RegExp(`[^a-z0-9]${N}\\s+${T}[^a-z0-9]`).test(t)) return true;
    }
  }
  return false;
}

// A shared name needs the story tied to this place (its town, street, area,
// postcode district or owner), or to be property / retail news set nowhere
// else; any name loses a story that places it in another town.
export function isAboutPlace(text: string, ctx: PlaceContext): boolean {
  if (namesElsewhere(text, ctx)) return false;
  if (!isSharedName(ctx.names[0] || "")) return true;
  const t = norm(text);
  // A town near the property's pin counts as its place too (Kings Cross →
  // London) when the address carries no town.
  const anchored = ctx.anchors.map(a => norm(a).trim()).filter(a => a.length >= 3)
    .some(a => new RegExp(`[^a-z0-9]${esc(a)}[^a-z0-9]`).test(t))
    || TOWNS.some(([town]) => new RegExp(`[^a-z0-9]${esc(town)}[^a-z0-9]`).test(t) && homeTown(town, ctx));
  if (anchored) return true;
  // Unanchored, a story set in another town ("…creating Aberdeen hub") is that town's.
  if (TOWNS.some(([town]) => new RegExp(`[^a-z0-9]${esc(town)}[^a-z0-9]`).test(t) && !homeTown(town, ctx))) return false;
  return PROPERTY_CONTEXT.test(t);
}

// London postcode areas: EC is the City, the rest are London.
const LONDON_AREAS = new Set(["e", "ec", "n", "nw", "se", "sw", "w", "wc"]);
export function postcodeAnchors(postcode: string | null | undefined): string[] {
  const m = /^\s*([a-z]{1,2})(\d[a-z\d]?)\b/i.exec(String(postcode || ""));
  if (!m) return [];
  const area = m[1].toLowerCase();
  const out = [`${area}${m[2].toLowerCase()}`];
  if (LONDON_AREAS.has(area)) out.push("london");
  if (area === "ec") out.push("city of london", "square mile");
  return out;
}
