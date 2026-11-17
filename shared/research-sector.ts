// Which sector a piece of investment research is filed under (Jack,
// 2026-11-17: "add some rules so the app knows what sub file to save it
// into"). Rules only, no AI. The file name counts five times a word in the
// text, so "London Office Q3.pdf" is decided by its name; the text breaks a
// tie or files a document with a plain name. A document that points two ways
// (or nowhere) goes to General: a wrong sector is worse than General, and the
// person can move it. Tests: server/research-sector.test.ts.
import { TRACKER_CLASSES } from "./tracker-class";

export const RESEARCH_AUTO = "auto";
export const RESEARCH_GENERAL = "General";

const SIGNALS = {
  retailPark: /retail parks?|retail warehous\w*|out[- ]of[- ]town|bulky goods/g,
  shoppingCentre: /shopping cent(?:re|er)s?|\bmalls?\b|outlet cent(?:re|er)s?/g,
  highStreet: /high streets?/g,
  retail: /\bretail(?:ers?|ing)?\b|footfall|\bshops?\b|\bstores?\b/g,
  office: /\boffices?\b|workspace|workplace|grade a\b|take-?up|\bflex(?:ible)? space/g,
  industrial: /industrial|logistics|(?<!retail )warehous(?:e|es|ing)\b|distribution|last[- ]mile|\bi&l\b|\bsheds?\b/g,
  residential: /residential|build[- ]to[- ]rent|\bbtr\b|\bpbsa\b|student accommodation|\bprs\b|co-?living|later living|housing/g,
  leisure: /\bleisure\b|\bhotels?\b|cinemas?|\bgyms?\b|fitness|competitive socialising|\bexperiential\b/g,
  fnb: /restaurants?|food (?:and|&) beverage|\bf&b\b|\bf & b\b|\bdining\b|\bpubs?\b|\bbars?\b|caf[eé]s?|food ?service/g,
  mixed: /mixed[- ]use/g,
  education: /\beducation\w*|\bschools?\b|nurser(?:y|ies)|healthcare|social infrastructure|universit(?:y|ies)|\bclinics?\b/g,
  london: /\blondon\b|west end|city of london|\bthe city\b|mayfair|\bsoho\b|canary wharf|king'?s cross|shoreditch|midtown|southbank|\bw1\b|\bec[1-4]\b/g,
  national: /\buk\b|\bregional\b|\bregions\b|\bnational\b|manchester|birmingham|leeds|bristol|edinburgh|glasgow|cardiff|liverpool|newcastle|nottingham|sheffield|reading|oxford|cambridge/g,
};
type Signal = keyof typeof SIGNALS;

const NAME_WEIGHT = 5;
const TEXT_CHARS = 30_000;

function cleanName(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.\-+]+/g, " ").toLowerCase();
}

function count(re: RegExp, text: string): number {
  re.lastIndex = 0;
  return (text.match(re) || []).length;
}

export function researchScores(fileName: string, text?: string | null): Record<Signal | "portfolio", number> {
  const name = cleanName(fileName || "");
  const body = String(text || "").slice(0, TEXT_CHARS).toLowerCase();
  const out = {} as Record<Signal | "portfolio", number>;
  for (const k of Object.keys(SIGNALS) as Signal[]) out[k] = count(SIGNALS[k], name) * NAME_WEIGHT + count(SIGNALS[k], body);
  // "portfolio" is in almost every report's text; only the name decides it.
  out.portfolio = /\bportfolios?\b/.test(name) ? NAME_WEIGHT : 0;
  return out;
}

const ahead = (a: number, b: number) => a > b * 1.5;

export function researchSectorFor(fileName: string, text?: string | null): string {
  const s = researchScores(fileName, text);
  const families: Array<[string, number]> = [
    ["Retail", s.retailPark + s.shoppingCentre + s.highStreet + s.retail],
    ["Office", s.office],
    ["Industrial", s.industrial],
    ["Residential", s.residential],
    ["Leisure Schemes", s.leisure],
    ["F&B - High Street", s.fnb],
    ["Mixed Use", s.mixed * 2],
    ["Portfolios", s.portfolio],
    ["Educational/Social", s.education],
  ];
  families.sort((a, b) => b[1] - a[1]);
  const [[top, best], [, second]] = families;
  if (best < 3 || !ahead(best, second)) return RESEARCH_GENERAL;

  const london = ahead(s.london, s.national) && s.london >= 2;
  const national = ahead(s.national, s.london) && s.national >= 2;
  let sector: string = top;
  if (top === "Office") {
    sector = london ? "Office London" : national ? "Office National" : RESEARCH_GENERAL;
  } else if (top === "Retail") {
    const sub: Array<[string, number]> = ([
      ["park", s.retailPark], ["centre", s.shoppingCentre], ["high", s.highStreet],
    ] as Array<[string, number]>).sort((a, b) => b[1] - a[1]);
    const [kind, n] = sub[0];
    const clear = n >= 2 && ahead(n, sub[1][1]);
    if (clear && kind === "park") sector = "Retail Parks";
    else if (clear && kind === "centre") sector = london ? "London Shopping Centre" : "Retail - Shopping Centre";
    else sector = london ? "Retail - London" : national || (clear && kind === "high") ? "Retail - High Street" : RESEARCH_GENERAL;
  }
  return (TRACKER_CLASSES as readonly string[]).includes(sector) ? sector : RESEARCH_GENERAL;
}
