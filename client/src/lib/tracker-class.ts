// Investment Tracker asset class (Jack, 2026-11-10/11): the board and the
// presentation pop-out list assets by class, in the order below, then by
// upload date. The same list is the key at the top of the board, the Asset
// Class column, the Add Asset form and the section bars.
//
// A class picked from the list is stored as-is. Anything else — an
// imported label ("Retail (high street)", "Office", "Leisure portfolio")
// or no label at all — is read into a class from the label and the asset's
// own words (name, address, tenure, notes). Where that takes a judgement
// (which kind of retail, London or national) it is marked "est." and never
// saved; picking a class from the list confirms it.

export const TRACKER_CLASSES = [
  "Retail - High Street",
  "Retail - Shopping Centre",
  "Retail - London",
  "Retail Parks",
  "Portfolios",
  "Office London",
  "Office National",
  "Industrial",
  "Mixed Use",
  "F&B - High Street",
  "Leisure Schemes",
  "Residential",
  "Educational/Social",
] as const;
export type TrackerClass = typeof TRACKER_CLASSES[number];

type ClassSource = { assetType?: string | null; assetName?: string | null; address?: string | null; tenure?: string | null; notes?: string | null };

// The broad family first; retail and office are then split below.
type Family = "Retail" | "Office" | "Industrial" | "Mixed Use" | "F&B" | "Leisure" | "Residential" | "Educational/Social";
const FAMILIES: Family[] = ["Retail", "Office", "Industrial", "Mixed Use", "F&B", "Leisure", "Residential", "Educational/Social"];

// Order matters: the first rule that matches wins, most specific first.
const RULES: Array<[Family, RegExp]> = [
  ["Mixed Use", /\bmixed[\s-]?use\b|\bmixed\b/],
  ["Educational/Social", /education|\bschools?\b|pre[\s-]?prep|nurser(y|ies)|\bcollege\b|universit|academy|\bsocial\b|community|\bchurch\b|place of worship|medical|surgery|\bclinic\b|dental|dentist|care home|\blibrary\b/],
  ["Leisure", /\bleisure\b|cinema|cineworld|odeon|\bvue\b|\bgyms?\b|david lloyd|pure ?gym|fitness|health club|theatre|bowling|casino|hotel|premier inn|travelodge|\bairport\b|trampoline|golf/],
  ["F&B", /\bf&b\b|restaurant|\bpubs?\b|\bbars?\b|caf[eé]|coffee|food hall|brasserie|slug and lettuce|\bitsu\b|nando|wagamama|mcdonald|\bkfc\b|pizza|brewery|tavern/],
  ["Industrial", /industrial|warehouse|logistics|distribution|trade park|trade counter|\bshed\b|self[\s-]?storage|data cent/],
  ["Residential", /residential|\bresi\b|apartments?|\bflats?\b|\bbtr\b|build to rent|\bpbsa\b|student|co-?living|townhouses?|mansions|\bhomes?\b/],
  ["Office", /\boffices?\b|\bhq\b|headquarters|workspace|business park|serviced office|\bwework\b/],
  ["Retail", /\bretail\b|shopping|\bshops?\b|\bstores?\b|supermarket|high street|\bmall\b|\barcade\b|\bparade\b|\bmarket\b|outlet|department store|tesco|sainsbury|\bm&s\b|marks (and|&) spencer|\blidl\b|\baldi\b|\bboots\b|tk ?maxx|waitrose|\bco-?op\b|primark|\bnext\b|\bzara\b|john lewis|\bhof\b|house of fraser|debenhams|bonmarch|max ?mara/],
  ["Mixed Use", /\bestate\b|\bquarter\b|\byards?\b|\bvillage\b/],
];

function matchFamily(text: string): Family | null {
  const t = text.toLowerCase();
  for (const [family, re] of RULES) if (re.test(t)) return family;
  return null;
}

// Notes mention all sorts in passing (a neighbouring office, a buyer's
// other holdings), so there the family with the most mentions wins.
function weighFamily(text: string): Family | null {
  const t = text.toLowerCase();
  let best: Family | null = null;
  let bestCount = 0;
  for (const family of FAMILIES) {
    const count = RULES.filter(([f]) => f === family)
      .reduce((n, [, re]) => n + (t.match(new RegExp(re.source, "g")) || []).length, 0);
    if (count > bestCount) { best = family; bestCount = count; }
  }
  return best;
}

// London: the word, a London postal district (W1, EC2, SW11, E15…) or a
// well-known central / inner area. Outer towns with their own postcodes
// (Kingston, Romford, Croydon) count as national unless the address says
// London.
const LONDON_RE = /\blondon\b|\b(?:ec|wc)\d[a-z]?\b|\b(?:sw|se|nw)\d{1,2}[a-z]?\b|\b[nwe]\d{1,2}[a-z]?\s+\d[a-z]{2}\b|\b[nwe]1[a-z]?\b|mayfair|\bsoho\b|covent garden|oxford street|regent street|bond street|savile row|piccadilly|st james|knightsbridge|chelsea|kensington|marylebone|fitzrovia|bloomsbury|holborn|shoreditch|islington|camden|battersea|clapham|fulham|wandsworth|notting hill|westbourne grove|tottenham court road|victoria embankment|king'?s road|berkeley square|hanover square|grosvenor|wardour street|kingsway|park lane|upper street|canary wharf|southbank|south bank|finsbury park|dalston|brixton|hammersmith|chiswick|putney|paddington|vauxhall/;
const isLondon = (text: string) => LONDON_RE.test(text.toLowerCase());

const RETAIL_PARK_RE = /retail park|shopping park|retail warehous/;
const SHOPPING_CENTRE_RE = /shopping cent(re|er)|\bmall\b|covered market|\barcade\b/;
const HIGH_STREET_RE = /high st(reet)?\b|high road/;

export function trackerClass(item: ClassSource): { cls: TrackerClass; estimated: boolean } {
  const label = (item.assetType || "").trim();
  const exact = TRACKER_CLASSES.find((c) => c.toLowerCase() === label.toLowerCase());
  if (exact) return { cls: exact, estimated: false };

  const labelLc = label.toLowerCase();
  const where = [item.assetName, item.address].filter(Boolean).join(" ");
  const whereLc = where.toLowerCase();

  // Portfolios stand apart whatever they hold.
  if (/portfolio/.test(labelLc)) return { cls: "Portfolios", estimated: false };
  if (/portfolio/.test((item.assetName || "").toLowerCase())) return { cls: "Portfolios", estimated: !label };

  // The family: the label's lead words first ("Retail (with upper floor
  // leisure)" is retail), then the whole label, then the asset's own words.
  const fromLabel = label ? matchFamily(label.split("(")[0]) || matchFamily(label) : null;
  const family: Family = fromLabel
    || matchFamily(where)
    || weighFamily([item.tenure, item.notes].filter(Boolean).join(" "))
    // BGP's tracker is overwhelmingly shops and shop-led buildings, so a
    // bare address with nothing else to go on is most likely retail.
    || "Retail";
  const familyKnown = !!fromLabel;

  if (family === "Retail") {
    // What the label itself says is taken as read…
    if (RETAIL_PARK_RE.test(labelLc)) return { cls: "Retail Parks", estimated: false };
    if (SHOPPING_CENTRE_RE.test(labelLc)) return { cls: "Retail - Shopping Centre", estimated: false };
    if (HIGH_STREET_RE.test(labelLc)) return { cls: "Retail - High Street", estimated: false };
    if (/\blondon\b/.test(labelLc)) return { cls: "Retail - London", estimated: false };
    // …otherwise the kind of retail is a best estimate from name + address.
    if (RETAIL_PARK_RE.test(whereLc)) return { cls: "Retail Parks", estimated: true };
    if (SHOPPING_CENTRE_RE.test(whereLc)) return { cls: "Retail - Shopping Centre", estimated: true };
    if (isLondon(where)) return { cls: "Retail - London", estimated: true };
    return { cls: "Retail - High Street", estimated: true };
  }
  if (family === "Office") {
    if (/\blondon\b/.test(labelLc)) return { cls: "Office London", estimated: false };
    if (/national|regional/.test(labelLc)) return { cls: "Office National", estimated: false };
    return { cls: isLondon(where) ? "Office London" : "Office National", estimated: true };
  }
  if (family === "F&B") return { cls: "F&B - High Street", estimated: !familyKnown };
  if (family === "Leisure") return { cls: "Leisure Schemes", estimated: !familyKnown };
  return { cls: family, estimated: !familyKnown };
}

/** Class order, then newest upload first. */
export function compareByClassThenUpload<T extends ClassSource & { createdAt?: string | Date | null }>(a: T, b: T): number {
  const byClass = TRACKER_CLASSES.indexOf(trackerClass(a).cls) - TRACKER_CLASSES.indexOf(trackerClass(b).cls);
  if (byClass !== 0) return byClass;
  return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
}
