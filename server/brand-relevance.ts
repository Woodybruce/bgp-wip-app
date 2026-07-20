// ─────────────────────────────────────────────────────────────────────────
// Brand-name relevance filtering.
//
// Many tracked brand names collide with unrelated things — "Creed" (the
// fragrance house vs Assassin's Creed), "Boots" (the pharmacy vs footwear),
// "Supreme" (streetwear vs the Supreme Court). Everything that matches text
// to a brand by name (news linking, the brand-page News & Media feed, image
// imports) should go through these helpers so brand pages only ever show
// content about the actual brand.
//
// Three generic layers (no per-brand hand lists needed):
//   1. Possessive-compound guard — an occurrence of "Creed" that only ever
//      appears as "Assassin's Creed" is naming a different entity entirely.
//   2. Off-topic domain guard — ambiguous single-word brands reject text that
//      is clearly about video games / film / music / sport / politics unless
//      the brand's own industry covers that domain. This also neutralises
//      traps like games "topping the UK retail charts", where the word
//      "retail" would otherwise read as retail context.
//   3. Context requirement — single-word (ambiguous) names additionally need
//      retail/property context or a term from the brand's own industry.
//      Multi-word names ("Pret A Manger") match on mention alone.
//
// Precision over recall: dropping a real article is better than showing an
// Assassin's Creed story on the Creed page.
// ─────────────────────────────────────────────────────────────────────────

export interface BrandIdentity {
  name: string;
  industry?: string | null;
}

const RETAIL_CONTEXT_TERMS = [
  "store", "stores", "retailer", "retailers", "shop front", "shopfront",
  "high street", "shopping centre", "shopping center", "shopping mall", "department store",
  "flagship", "boutique", "outlet", "concession", "pop-up", "popup", "franchise", "franchisee",
  "restaurant", "restaurants", "cafe", "café", "coffee shop", "bakery", "bar", "pub", "hotel",
  "gym", "fitness studio", "salon", "pharmacy", "supermarket", "grocer", "grocery",
  "lease", "leasing", "landlord", "tenant", "premises", "sq ft", "square feet", "unit",
  "opening", "opens", "openings", "closure", "closures", "closing", "site", "sites",
  "expansion", "rollout", "roll-out", "administration", "cva", "insolvency",
  "turnover", "revenue", "profit", "profits", "sales", "like-for-like", "trading update",
  "menu", "chain", "hospitality", "occupier", "brand", "retail park",
];

// Note: bare "retail" is deliberately not a context term — phrases like
// "UK retail charts" (games sales) would smuggle irrelevant articles in.
// "retailer", "retail park" etc. cover the genuine uses.

// Clearly-other-domain markers. An ambiguous brand name plus any of these
// (without a matching industry) means the text is about the namesake.
const OFF_TOPIC_DOMAINS: Array<{ pattern: RegExp; industryExempt: RegExp }> = [
  { // video games
    pattern: /\bvideo ?games?\b|\bgameplay\b|\bplaystation\b|\bps[45]\b|\bxbox\b|\bnintendo\b|\bubisoft\b|\bdlc\b|\bremaster(?:ed)?\b|\bconsoles?\b|\bretail charts\b|\bsales charts\b|\bgame charts\b|\bps store\b/i,
    industryExempt: /gam|entertainment|electronic|toy/i,
  },
  { // film & tv
    pattern: /\bbox office\b|\bfilm review\b|\bmovie\b|\btrailer\b|\bnetflix\b|\bepisode\b|\bseason \d\b|\bcinemas?\b|\bstreaming series\b/i,
    industryExempt: /cinema|entertainment|media|film/i,
  },
  { // music
    pattern: /\balbum\b|\btour dates\b|\bsetlist\b|\bfrontman\b|\bnew single\b|\bband'?s\b/i,
    industryExempt: /music|entertainment/i,
  },
  { // sport
    pattern: /\bpremier league\b|\bworld cup\b|\bfootball club\b|\bmatchday\b|\buefa\b|\btransfer window\b/i,
    industryExempt: /sport|fitness|footwear|athleisure|gym/i,
  },
  { // politics & courts
    pattern: /\bsupreme court\b|\bparliament\b|\bsenate\b|\bscotus\b|\bimpeach|\bby-?election\b/i,
    industryExempt: /^\b$/, // never exempt
  },
];

export function normalizeBrandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, "")
    .replace(/\b(ltd|limited|plc|uk|holdings|group)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Single-token names can mean something else entirely; multi-word names are
// close to unique ("Pret A Manger", "Oliver Bonas").
export function isAmbiguousBrandName(name: string): boolean {
  const normalized = normalizeBrandName(name);
  return !normalized.includes(" ");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function brandTokenRegex(brandName: string): RegExp | null {
  const normalized = normalizeBrandName(brandName);
  if (normalized.length < 3) return null;
  const pattern = normalized.split(" ").map(escapeRegex).join("\\s+");
  return new RegExp(`(^|[^a-z0-9])(${pattern})(?=[^a-z0-9]|$)`, "gi");
}

// Loose check: does the brand token appear at a word boundary at all?
// (Includes possessive-compound occurrences — use textMentionsBrand for the
// strict version.)
export function brandTokenAppears(text: string, brandName: string): boolean {
  const re = brandTokenRegex(brandName);
  return re ? re.test(text.toLowerCase()) : false;
}

// Strict check: at least one occurrence of the brand name that is NOT the
// tail of a possessive compound naming something else — "Assassin's Creed",
// "sailor's creed" never count as mentions of the brand "Creed".
export function textMentionsBrand(text: string, brandName: string): boolean {
  const re = brandTokenRegex(brandName);
  if (!re) return false;
  const lower = text.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    const tokenStart = m.index + m[1].length;
    const prevWord = lower.slice(0, tokenStart).match(/([a-z0-9&']+)\s*$/)?.[1] || "";
    if (/(?:'s|s')$/.test(prevWord)) continue;
    return true;
  }
  return false;
}

export function hasBrandContext(text: string, brand: BrandIdentity): boolean {
  const lower = text.toLowerCase();
  const industryTerms = (brand.industry || "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 4);
  return [...industryTerms, ...RETAIL_CONTEXT_TERMS].some((term) => lower.includes(term));
}

function isOffTopicDomain(text: string, industry: string | null | undefined): boolean {
  const ind = industry || "";
  return OFF_TOPIC_DOMAINS.some((d) => d.pattern.test(text) && !d.industryExempt.test(ind));
}

// The main gate: is this text about the brand, not something sharing its name?
export function isTextRelevantToBrand(text: string, brand: BrandIdentity): boolean {
  if (!brand.name?.trim() || !text?.trim()) return false;
  if (!textMentionsBrand(text, brand.name)) return false;
  if (!isAmbiguousBrandName(brand.name)) return true;
  if (isOffTopicDomain(text, brand.industry)) return false;
  return hasBrandContext(text, brand);
}

// Standard disambiguation block for AI prompts that research a brand by name.
export function brandDisambiguationNote(brand: { name: string; domain?: string | null; industry?: string | null }): string {
  const anchors = [
    brand.industry ? `industry: ${brand.industry}` : null,
    brand.domain ? `website: ${brand.domain}` : null,
  ].filter(Boolean).join(", ");
  return `IMPORTANT — name disambiguation: "${brand.name}" may be shared by unrelated entities (films, video games, bands, generic products, or other companies). This record is the retail/hospitality/leisure company relevant to UK commercial property${anchors ? ` (${anchors})` : ""}. Only report facts about that specific company. If you cannot confidently identify it, return nulls/unknown rather than mixing in facts about anything else called "${brand.name}".`;
}
