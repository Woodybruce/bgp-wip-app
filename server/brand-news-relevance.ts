import { getBrandIdentity, normalizeBrandDomain } from "./brand-identity";

type NewsArticle = { title?: string | null; summary?: string | null; url?: string | null };

// A search result is only a candidate. Common words and short names need an
// independent clue; capitalisation or membership of a brand feed is not proof.
const COMMON_NAMES = new Set([
  "sky", "next", "cook", "until", "fuel", "pitch", "base", "oliver", "supreme",
  "coach", "monsoon", "jigsaw", "diesel", "pandora", "boots", "river", "bills",
  "mountain", "gap", "mango", "space", "end", "size", "apple", "office", "white stuff",
  "zara", "oasis", "joules", "pret", "wren", "iceland", "river island",
]);
// Brands that are also first names: "Zara Larsson" / "Zara Tindall" is a
// person, not the retailer, however much fashion is nearby (Woody, 2026-09-28).
const FIRST_NAME_BRANDS = new Set(["zara", "wren"]);
const KNOWN_NAMESAKES = /^(?:larsson|mcdermott|tindall|phillips|holland|hunt)$/i;
const BRAND_FOLLOWERS = new Set(["home", "kids", "man", "men", "woman", "women", "store", "stores", "shop", "shops", "uk",
  "group", "outlet", "flagship", "sa", "owner", "inditex", "opens", "open", "launches", "sales", "profits", "results",
  "boss", "plans", "and", "kitchens", "origins", "larger", "new"]);
function personNamesake(name: string, cased: string, index: number): boolean {
  if (!FIRST_NAME_BRANDS.has(name)) return false;
  const next = cased.slice(index).replace(/^ /, "").slice(name.length).trim().split(" ")[0] || "";
  if (KNOWN_NAMESAKES.test(next)) return true;
  if (!/^(?:Mc)?[A-Z][a-z]+(?:[A-Z][a-z]+)?$/.test(next) || BRAND_FOLLOWERS.has(next.toLowerCase())) return false;
  // In a Title Case headline every word is capitalised, so a capital proves
  // nothing there.
  const long = cased.split(" ").filter(w => w.length > 3);
  const capitalised = long.filter(w => /^[A-Z]/.test(w)).length;
  return long.length > 0 && capitalised / long.length < 0.7;
}
const GENERIC_SHORT_NAMES = new Set(["uk", "us", "eu", "the", "and", "a", "an"]);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&(?:apos|#39|#x27);/gi, "'")
    .replace(/&(?:amp|#38);/gi, "&").replace(/&(?:nbsp|#160);/gi, " ");
}
// dropPossessive reads "Cushman & Wakefield's" as "cushman and wakefield";
// without it the apostrophe strip made "wakefields" and the firm's own
// reports stopped matching (Woody, 2026-09-28). Names keep the plain form so
// "Nando's" still meets "Nandos".
function words(value: string, lower = true, dropPossessive = false): string {
  let text = plainText(value).normalize("NFKD").replace(/[̀-ͯ]/g, "");
  if (dropPossessive) text = text.replace(/([a-zA-Z0-9])[’']s\b/gi, "$1");
  text = text.replace(/[’']/g, "").replace(/&/g, " and ").replace(/[^a-zA-Z0-9]+/g, " ").trim();
  return (lower ? text.toLowerCase() : text).replace(/\s+/g, " ");
}
function nameWords(value: string): string {
  return words(value).replace(/\s+(?:ltd|limited|plc|inc|llc)$/, "").trim();
}
// Which reading of the text carries the name: plain, or possessive dropped.
function possessiveReading(text: string, name: string): boolean | null {
  if (!name) return null;
  if ((` ${words(text)} `).includes(` ${name} `)) return false;
  return (` ${words(text, true, true)} `).includes(` ${name} `) ? true : null;
}
function containsName(text: string, name: string): boolean {
  return possessiveReading(text, name) !== null;
}
// "Grosvenor Casinos", "the Grosvenor Arms", "Grosvenor Hotel" are namesakes,
// not the estate — unless the story is about property (Woody, 2026-09-28).
const NAMESAKE_NOUNS = /^(?:casinos?|arms|hotels?|square|street|st|road|rd|house|avenue|place|park|gardens|bridge|crescent|terrace|lane|inn|pub|tavern|bar|club|cinema|theatre|school|college|hospital|chapel|court|hall|lodge)$/;
const PROPERTY_CONTEXT = /\b(?:property|properties|estate|estates|landlord|landlords|real estate|developer|development|portfolio|leasing|lettings?|freehold|leasehold|mayfair|belgravia)\b/;
function namesakeOnly(name: string, text: string): boolean {
  const drop = possessiveReading(text, name);
  if (drop === null) return false;
  const normalized = words(text, true, drop);
  const followers = [...normalized.matchAll(new RegExp(`(?:^| )${escapeRegex(name)}(?: (\\w+)|$)`, "g"))].map(m => m[1] || "");
  return followers.length > 0 && followers.every(w => NAMESAKE_NOUNS.test(w)) && !PROPERTY_CONTEXT.test(normalized);
}
// Competition T&Cs pages are not news about anyone (Deliveroo's promo
// terms were landing on Nando's and Wingstop, Woody 2026-09-28).
const TERMS_PAGE = /\b(?:terms (?:and|&) conditions|t ?& ?cs?|competition (?:terms|rules)|terms of (?:entry|use)|promotion terms|prize draw terms)\b/i;
const TERMS_URL = /\/[\w-]*(?:terms|t-and-c|t-cs|tandcs?)[\w-]*(?:\/|\.html?|\?|$)/i;
function isAgentFirm(company: any): boolean {
  return /^agent/i.test(String(company?.company_type ?? company?.companyType ?? "")) || !!(company?.agent_type ?? company?.agentType);
}
function ambiguous(name: string): boolean {
  return name.replace(/\s/g, "").length <= 4 || COMMON_NAMES.has(name);
}
function casedMention(text: string, name: string): boolean {
  const normalized = words(name, false);
  const variants = [normalized, normalized.toUpperCase()];
  // AS / BP / GAP must not match ordinary "As", "bp" or "gap" prose.
  if (normalized.replace(/\s/g, "").length > 3) {
    variants.push(normalized.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase()));
  }
  const readings = [words(text, false), words(text, false, true)];
  return variants.some(value => value !== value.toLowerCase()
    && readings.some(reading => new RegExp(`(?:^| )${escapeRegex(value)}(?: |$)`).test(reading)));
}

function confirmedNewsIdentity(company: any) {
  // Drizzle ingestion rows use camelCase; SQL profile rows use snake_case.
  const row = { ...company, domain_url: company?.domain_url ?? company?.domainUrl,
    ai_generated_fields: company?.ai_generated_fields ?? company?.aiGeneratedFields };
  const identity = getBrandIdentity(row);
  const saved = row.ai_generated_fields?.brand_identity;
  // Do not turn unreviewed, enriched legal names into approved search aliases.
  const aliases = identity.status === "verified" && Array.isArray(saved?.aliases)
    ? saved.aliases.filter((value: unknown): value is string => typeof value === "string" && !!value.trim()) : [];
  return { domain: identity.status === "verified" ? identity.domain : null,
    names: [...new Set([String(company?.name || ""), ...aliases])].filter(Boolean) };
}

function domainEvidence(domain: string, article: NewsArticle, text: string): boolean {
  const host = normalizeBrandDomain(article.url);
  if (host === domain || host?.endsWith(`.${domain}`)) return true;
  // Only actual domain tokens count, never a lookalike host or URL query/path
  // containing the official name. Link targets hidden in HTML do not count.
  const plain = plainText(text);
  for (const url of plain.match(/https?:\/\/\S+/gi) || []) {
    const linkedHost = normalizeBrandDomain(url.replace(/[.,;:!?)]+$/, ""));
    if (linkedHost === domain || linkedHost?.endsWith(`.${domain}`)) return true;
  }
  const prose = plain.replace(/https?:\/\/\S+/gi, " ");
  return new RegExp(`(?:^|[^a-z0-9.@/-])${escapeRegex(domain)}(?![a-z0-9-]|\\.[a-z0-9])`, "i").test(prose);
}

function namedContext(name: string, rawName: string, text: string, industry: string): boolean {
  let candidate = text;
  if (name === "cook") {
    // Remove complete colliding names, not the whole article: a story can
    // legitimately discuss COOK and another Cook in separate sentences.
    candidate = candidate.replace(/\b(?:thomas|beryl|tim|lisa|james|captain|mr|chef)\s+cook\b|\bcook\s+(?:islands?|county|medical|construction|group)\b/gi, " ")
      .replace(/\b(?:how to|to|can|should|will|we|you|they)\s+cook\b/gi, " ");
  }
  if (!containsName(candidate, name) || !casedMention(candidate, rawName)) return false;
  // Check context close to the name, rather than borrowing "retail" from an
  // unrelated paragraph in a long roundup.
  const drop = possessiveReading(candidate, name) === true;
  const normalized = words(candidate, true, drop);
  const cased = words(candidate, false, drop);
  const mentions = normalized.matchAll(new RegExp(`(?:^| )${escapeRegex(name)}(?= |$)`, "g"));
  for (const mention of mentions) {
    if (personNamesake(name, cased, mention.index!)) continue;
    const nearby = normalized.slice(Math.max(0, mention.index! - 90), mention.index! + name.length + 130);
    if (name === "cook") {
      if (/\b(?:frozen (?:food|meals?)|ready meals?|edward perry|dale penfold)\b/.test(nearby)
        && /\b(?:retailer|brand|chain|company|stores?|shops?|founders?|sales|profit|profits|turnover|expansion|trading|employees?|perry|penfold)\b/.test(nearby)) return true;
      continue;
    }
    // Known everyday meanings cannot be rescued by an unrelated sector word.
    const collisions: Record<string, RegExp> = {
      supreme: /\bsupreme court\b|\bscotus\b/,
      next: /\bnext (?:week|month|year|day|generation)\b|\bwhats next\b/,
      coach: /\b(?:football|coach hire|bus|coachway)\b/,
      monsoon: /\b(?:rain|weather|forecast|monsoon season)\b/,
      boots: /\b(?:football|wellington|working) boots\b/,
      bills: /\b(?:buffalo|nfl|quarterback|touchdown|energy bills?|tax bills?|food bills?|household bills?)\b/,
      mango: /\b(?:mango fruit|mango harvest|mango crop|mango recipe)\b/,
      diesel: /\b(?:diesel fuel|diesel engine|diesel prices)\b/,
      pandora: /\b(?:pandora radio|streaming|spotify)\b/,
    };
    if (collisions[name]?.test(nearby)) continue;
    const ind = industry.toLowerCase();
    if (/fashion|apparel|retail|luxury|footwear|jewel|leather/.test(ind)
      && /\b(?:retailer|retail|fashion|clothing|apparel|jewellery|jewelry|footwear|department store)\b/.test(nearby)) return true;
    if (/food|restaurant|hospitality|coffee|cafe|bar|pub|qsr/.test(ind)
      && /\b(?:restaurant|restaurants|cafe|cafes|coffee chain|bakery|pub chain|dining chain)\b/.test(nearby)) return true;
    if (/beauty|skincare|cosmetic/.test(ind) && /\b(?:beauty|skincare|cosmetics)\b/.test(nearby)) return true;
    if (/fitness|gym|wellness/.test(ind) && /\b(?:gym|gyms|fitness|wellness)\b/.test(nearby)) return true;
  }
  return false;
}

export function isBrandNewsRelevant(company: any, article: NewsArticle): boolean {
  const identity = confirmedNewsIdentity(company);
  if (!identity.names.length) return false;
  if (TERMS_PAGE.test(article.title || "") || TERMS_URL.test(String(article.url || "").replace(/^https?:\/\/[^/]+/i, ""))) return false;
  // Ignore AI summaries: a generated mention cannot corroborate its own link.
  const rawTitle = article.title || "";
  const title = rawTitle.replace(/\s[-–—|·]\s[^-–—|·]{2,60}$/, "");
  const tail = rawTitle.slice(title.length).replace(/^\s[-–—|·]\s/, "");
  // An agent firm is named in plenty of stories about other firms ("joins
  // from Knight Frank") — its news must name it in the headline
  // (Woody, 2026-09-28).
  const agent = isAgentFirm(company);
  const text = agent ? title : `${title} ${article.summary || ""}`;
  if (identity.domain && (agent
    ? (() => { const host = normalizeBrandDomain(article.url); return host === identity.domain || !!host?.endsWith(`.${identity.domain}`); })()
    : domainEvidence(identity.domain, article, text))) return true;
  for (const rawName of identity.names) {
    const name = nameWords(rawName);
    // "… - Savills": the firm published it.
    if (agent && tail && !ambiguous(name) && nameWords(tail) === name) return true;
    if (!containsName(text, name)) continue;
    if (namesakeOnly(name, text)) continue;
    if (!ambiguous(name)) return true;
    if (!GENERIC_SHORT_NAMES.has(name) && namedContext(name, rawName, text, company?.industry || "")) return true;
  }
  return false;
}

export function isBrandSignalRelevant(company: any, signal: { source?: string | null; headline?: string | null; detail?: string | null }): boolean {
  const source = signal.source || "";
  // Staff notes and structured provider signals already belong to a company;
  // they need not repeat its name. Social posts use separately configured
  // brand channels and are not keyword-search news results.
  if (!/^https?:\/\//i.test(source)) return true;
  const host = normalizeBrandDomain(source);
  if (host && /^(?:www\.)?(?:instagram\.com|linkedin\.com|x\.com|twitter\.com)$/.test(host)) return true;
  return isBrandNewsRelevant(company, { title: signal.headline, summary: signal.detail, url: source });
}
