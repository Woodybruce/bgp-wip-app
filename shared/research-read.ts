// The key points read from a piece of investment research (Jack, 2026-11-17:
// "Will the app learn from these research papers over time? ... help the
// feed", then "yes go ahead with all three"). The reader (Anthropic, in
// server/investment-research-intel.ts) proposes; these checks decide what is
// kept. A fact is kept only when its quote is in the paper's own text and its
// figure is in that quote, so nothing the paper does not say is ever saved.
// Tests: server/research-read.test.ts.

export type ResearchFact = { topic: string; figure: string; place: string | null; period: string | null; quote: string };
export type ResearchReading = {
  publisher: string | null;
  published: string | null; // yyyy-mm, as the paper states it
  headline: string;
  summary: string;
  outlook: string | null;
  facts: ResearchFact[];
  dropped: number; // facts the checks refused
};

export const RESEARCH_MAX_FACTS = 12;

const squash = (s: string) => s.toLowerCase()
  .replace(/[‘’‛']/g, "'").replace(/[“”"]/g, '"')
  .replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();
const digitsOf = (s: string) => s.replace(/[^0-9.]/g, "").replace(/^\.+|\.+$/g, "");
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The quote is in the paper, give or take spacing, case and typographic quotes. */
export function quoteInText(quote: string, text: string): boolean {
  const q = squash(quote);
  return q.length >= 8 && squash(text).includes(q);
}

/** Every number in the figure is in the quote ("5.25%" needs 5.25 there). */
export function figureInQuote(figure: string, quote: string): boolean {
  const nums = figure.match(/\d[\d,.]*/g) || [];
  if (!nums.length) return false;
  const q = squash(quote).replace(/,/g, "");
  return nums.every((n) => { const d = digitsOf(n.replace(/,/g, "")); return !!d && q.includes(d); });
}

export function checkResearchAnswer(answer: any, text: string, today: Date = new Date()): ResearchReading | null {
  if (!answer || typeof answer !== "object") return null;
  const headline = str(answer.headline, 140);
  const summary = str(answer.summary, 700);
  if (!headline || !summary) return null;
  let published: string | null = null;
  const pm = str(answer.published, 10).match(/^(\d{4})-(\d{2})$/);
  if (pm) {
    const y = +pm[1], m = +pm[2];
    const limit = today.getUTCFullYear() * 12 + today.getUTCMonth() + 1;
    if (y >= 2000 && m >= 1 && m <= 12 && y * 12 + m - 1 <= limit) published = `${pm[1]}-${pm[2]}`;
  }
  const facts: ResearchFact[] = [];
  let dropped = 0;
  for (const f of Array.isArray(answer.facts) ? answer.facts : []) {
    const fact: ResearchFact = {
      topic: str(f?.topic, 80), figure: str(f?.figure, 60),
      place: str(f?.place, 60) || null, period: str(f?.period, 40) || null, quote: str(f?.quote, 400),
    };
    if (!fact.topic || !fact.figure || !quoteInText(fact.quote, text) || !figureInQuote(fact.figure, fact.quote)) { dropped++; continue; }
    if (facts.some((x) => squash(x.quote) === squash(fact.quote) && x.figure === fact.figure)) continue;
    if (facts.length < RESEARCH_MAX_FACTS) facts.push(fact);
  }
  return {
    publisher: str(answer.publisher, 80) || null,
    published,
    headline,
    summary,
    outlook: str(answer.outlook, 500) || null,
    facts,
    dropped,
  };
}

// The insight feed's categories, from a research sector.
export function insightCategoryForSector(sector: string): string {
  if (/^office/i.test(sector)) return "offices";
  if (/retail|shopping centre/i.test(sector)) return "retail";
  if (/^leisure/i.test(sector)) return "leisure";
  if (/^f&b/i.test(sector)) return "hospitality";
  return "investment";
}
