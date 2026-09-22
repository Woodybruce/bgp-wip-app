import { getBrandIdentity, normalizeBrandDomain } from "./brand-identity";

type NewsArticle = { title?: string | null; summary?: string | null; url?: string | null };

// A search result is only a candidate. Common words and short names need an
// independent clue; capitalisation or membership of a brand feed is not proof.
const COMMON_NAMES = new Set([
  "sky", "next", "cook", "until", "fuel", "pitch", "base", "oliver", "supreme",
  "coach", "monsoon", "jigsaw", "diesel", "pandora", "boots", "river", "bills",
  "mountain", "gap", "mango", "space", "end", "size", "apple", "office", "white stuff",
]);
const GENERIC_SHORT_NAMES = new Set(["uk", "us", "eu", "the", "and", "a", "an"]);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&(?:apos|#39|#x27);/gi, "'")
    .replace(/&(?:amp|#38);/gi, "&").replace(/&(?:nbsp|#160);/gi, " ");
}
function words(value: string, lower = true): string {
  const text = plainText(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "").replace(/&/g, " and ").replace(/[^a-zA-Z0-9]+/g, " ").trim();
  return (lower ? text.toLowerCase() : text).replace(/\s+/g, " ");
}
function nameWords(value: string): string {
  return words(value).replace(/\s+(?:ltd|limited|plc|inc|llc)$/, "").trim();
}
function containsName(text: string, name: string): boolean {
  return !!name && (` ${words(text)} `).includes(` ${name} `);
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
  return variants.some(value => value !== value.toLowerCase()
    && new RegExp(`(?:^| )${escapeRegex(value)}(?: |$)`).test(words(text, false)));
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
  const normalized = words(candidate);
  const mentions = normalized.matchAll(new RegExp(`(?:^| )${escapeRegex(name)}(?= |$)`, "g"));
  for (const mention of mentions) {
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
  // Ignore AI summaries: a generated mention cannot corroborate its own link.
  const title = (article.title || "").replace(/\s[-–—|·]\s[^-–—|·]{2,60}$/, "");
  const text = `${title} ${article.summary || ""}`;
  if (identity.domain && domainEvidence(identity.domain, article, text)) return true;
  for (const rawName of identity.names) {
    const name = nameWords(rawName);
    if (!containsName(text, name)) continue;
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
