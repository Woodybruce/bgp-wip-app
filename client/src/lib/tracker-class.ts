// Investment Tracker asset class (Jack, 2026-11-10): the board and the
// presentation pop-out list assets by class — Retail, Office, Industrial,
// Mixed Use, F&B, Leisure, Residential — then by upload date. An asset
// with no class label gets a best estimate from its own words (name,
// address, tenure, notes) so it still lands in a section; estimates are
// marked "est." and never saved — setting the Asset Class label fixes it.

export const TRACKER_CLASSES = ["Retail", "Office", "Industrial", "Mixed Use", "F&B", "Leisure", "Residential"] as const;
export type TrackerClass = typeof TRACKER_CLASSES[number];

type ClassSource = { assetType?: string | null; assetName?: string | null; address?: string | null; tenure?: string | null; notes?: string | null };

// Order matters: the first rule that matches wins, most specific first.
const RULES: Array<[TrackerClass, RegExp]> = [
  ["Mixed Use", /\bmixed[\s-]?use\b|\bmixed\b/],
  ["Leisure", /\bleisure\b|cinema|cineworld|odeon|\bvue\b|\bgyms?\b|david lloyd|pure ?gym|fitness|health club|theatre|bowling|casino|hotel|premier inn|travelodge|\bairport\b|trampoline|golf/],
  ["F&B", /\bf&b\b|restaurant|\bpubs?\b|\bbars?\b|caf[eé]|coffee|food hall|brasserie|slug and lettuce|\bitsu\b|nando|wagamama|mcdonald|\bkfc\b|pizza|brewery|tavern/],
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

export function trackerClass(item: ClassSource): { cls: TrackerClass; estimated: boolean } {
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
