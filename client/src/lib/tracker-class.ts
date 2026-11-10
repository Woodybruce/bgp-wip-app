// Investment Tracker asset class (Jack, 2026-11-10): the board and the
// presentation pop-out list assets by class — Retail - High Street, Retail -
// Shopping Centre, Retail (parks, portfolios and anything unspecified),
// Office, Industrial, Mixed Use, F&B - High Street, Leisure Parks, Residential,
// Educational/Social — then by upload date. An asset
// with no class label gets a best estimate from its own words (name,
// address, tenure, notes) so it still lands in a section; estimates are
// marked "est." and never saved — setting the Asset Class label fixes it.

export const TRACKER_CLASSES = ["Retail - High Street", "Retail - Shopping Centre", "Retail", "Office", "Industrial", "Mixed Use", "F&B - High Street", "Leisure Parks", "Residential", "Educational/Social"] as const;
export type TrackerClass = typeof TRACKER_CLASSES[number];

type ClassSource = { assetType?: string | null; assetName?: string | null; address?: string | null; tenure?: string | null; notes?: string | null };

// Order matters: the first rule that matches wins, most specific first.
const RULES: Array<[TrackerClass, RegExp]> = [
  ["Mixed Use", /\bmixed[\s-]?use\b|\bmixed\b/],
  ["Educational/Social", /education|\bschools?\b|pre[\s-]?prep|nurser(y|ies)|\bcollege\b|universit|academy|\bsocial\b|community|\bchurch\b|place of worship|medical|surgery|\bclinic\b|dental|dentist|care home|\blibrary\b/],
  ["Leisure Parks", /\bleisure\b|cinema|cineworld|odeon|\bvue\b|\bgyms?\b|david lloyd|pure ?gym|fitness|health club|theatre|bowling|casino|hotel|premier inn|travelodge|\bairport\b|trampoline|golf/],
  ["F&B - High Street", /\bf&b\b|restaurant|\bpubs?\b|\bbars?\b|caf[eé]|coffee|food hall|brasserie|slug and lettuce|\bitsu\b|nando|wagamama|mcdonald|\bkfc\b|pizza|brewery|tavern/],
  ["Industrial", /industrial|warehouse|logistics|distribution|trade park|trade counter|\bshed\b|self[\s-]?storage|data cent/],
  ["Residential", /residential|\bresi\b|apartments?|\bflats?\b|\bbtr\b|build to rent|\bpbsa\b|student|co-?living|townhouses?|mansions|\bhomes?\b/],
  ["Office", /\boffices?\b|\bhq\b|headquarters|workspace|business park|serviced office|\bwework\b/],
  ["Retail", /\bretail\b|shopping|\bshops?\b|\bstores?\b|supermarket|high street|\bmall\b|\barcade\b|\bparade\b|\bmarket\b|outlet|department store|tesco|sainsbury|\bm&s\b|marks (and|&) spencer|\blidl\b|\baldi\b|\bboots\b|tk ?maxx|waitrose|\bco-?op\b|primark|\bnext\b|\bzara\b|john lewis|\bhof\b|house of fraser|debenhams|bonmarch|max ?mara/],
  ["Mixed Use", /\bestate\b|\bquarter\b|\bportfolio\b|\byards?\b|\bvillage\b/],
];

function matchClass(text: string): TrackerClass | null {
  const t = text.toLowerCase();
  for (const [cls, re] of RULES) if (re.test(t)) return cls;
  return null;
}

// Notes mention all sorts in passing (a neighbouring office, a buyer's
// other holdings), so there the class with the most mentions wins.
function weighClass(text: string): TrackerClass | null {
  const t = text.toLowerCase();
  let best: TrackerClass | null = null;
  let bestCount = 0;
  for (const cls of TRACKER_CLASSES) {
    const count = RULES.filter(([c]) => c === cls)
      .reduce((n, [, re]) => n + (t.match(new RegExp(re.source, "g")) || []).length, 0);
    if (count > bestCount) { best = cls; bestCount = count; }
  }
  return best;
}

// Retail splits into high street and shopping centre where the label or
// the asset's own name / address says which; otherwise it stays "Retail".
function retailKind(text: string): TrackerClass {
  const t = text.toLowerCase();
  if (/shopping cent(re|er)|\bmall\b|covered market|\barcade\b/.test(t)) return "Retail - Shopping Centre";
  if (/high st(reet)?\b|high road/.test(t)) return "Retail - High Street";
  return "Retail";
}

export function trackerClass(item: ClassSource): { cls: TrackerClass; estimated: boolean } {
  const base = baseClass(item);
  if (base.cls !== "Retail") return base;
  const label = (item.assetType || "").trim();
  // A plain "Retail" label someone picked from the list stays as picked.
  if (!base.estimated && label.toLowerCase() === "retail") return base;
  const fromLabel = retailKind(label);
  if (fromLabel !== "Retail") return { cls: fromLabel, estimated: base.estimated };
  return { cls: retailKind([item.assetName, item.address].filter(Boolean).join(" ")), estimated: base.estimated };
}

function baseClass(item: ClassSource): { cls: TrackerClass; estimated: boolean } {
  const label = (item.assetType || "").trim();
  if (label) {
    const exact = TRACKER_CLASSES.find((c) => c.toLowerCase() === label.toLowerCase());
    if (exact) return { cls: exact, estimated: false };
    // A free-text label ("Retail (high street)", "Shopping centre",
    // "Leisure portfolio") is someone's own classification — read it first.
    // The words before any bracket lead: "Retail (with upper floor leisure)"
    // is Retail, "Office (ground floor F&B)" is Office.
    const fromLabel = matchClass(label.split("(")[0]) || matchClass(label);
    if (fromLabel) return { cls: fromLabel, estimated: false };
  }
  const guess = matchClass([item.assetName, item.address].filter(Boolean).join(" "))
    || weighClass([item.tenure, item.notes].filter(Boolean).join(" "));
  // BGP's tracker is overwhelmingly shops and shop-led buildings, so a bare
  // street address with nothing else to go on is most likely retail.
  return { cls: guess || "Retail", estimated: true };
}

/** Class order, then newest upload first. */
export function compareByClassThenUpload<T extends ClassSource & { createdAt?: string | Date | null }>(a: T, b: T): number {
  const byClass = TRACKER_CLASSES.indexOf(trackerClass(a).cls) - TRACKER_CLASSES.indexOf(trackerClass(b).cls);
  if (byClass !== 0) return byClass;
  return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
}
