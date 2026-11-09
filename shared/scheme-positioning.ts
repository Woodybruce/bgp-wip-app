// A scheme's positioning decides who it is compared with and which brands
// count as a fit (Woody, 2026-09-28: the Royal Exchange — a City luxury
// arcade — was being benchmarked against regional malls and pitched Five
// Guys and KFC). Luxury / prime schemes are read against London's luxury
// destinations on luxury & premium retail plus premium dining; mainstream
// schemes keep the hospitality / F&B / leisure slice and the top UK centres;
// value schemes drop luxury brands.
import { isClientCrmCategory } from "./tenant-categories";

export type SchemePositioning = "luxury" | "mainstream" | "value";
export type PositioningSource = "tag" | "tenant_mix" | "default";
// mass = quick-service, value and mass-market chains.
export type BrandTier = "luxury" | "premium" | "mass" | null;

export const POSITIONING_PROFILES: Record<SchemePositioning, { label: string; categories: string; peers: string; peersShort: string; brandsNoun: string }> = {
  luxury: { label: "Luxury / prime", categories: "luxury & premium retail, jewellery & watches, beauty, premium dining & cafés", peers: "London's luxury destinations", peersShort: "Luxury peers", brandsNoun: "luxury, premium & dining brands" },
  mainstream: { label: "Mainstream", categories: "hospitality, F&B, wellness & leisure", peers: "the top UK centres", peersShort: "Top centres", brandsNoun: "F&B & leisure brands" },
  value: { label: "Value", categories: "hospitality, F&B, wellness & leisure", peers: "the top UK centres", peersShort: "Top centres", brandsNoun: "F&B & leisure brands" },
};

// The property's tags carry the positioning. An exact tag ("luxury",
// "mainstream", "value" — what the Positioning control writes) wins; a
// descriptive tag ("luxury retail", "prime") also reads as luxury.
const EXACT_TAG: Record<string, SchemePositioning> = { luxury: "luxury", prime: "luxury", "luxury / prime": "luxury", mainstream: "mainstream", value: "value" };
const tagTokens = (tags: string | null | undefined) => String(tags || "").split(/[,;\n]/).map(t => t.trim()).filter(Boolean);

export function exactPositioningTag(tags: string | null | undefined): SchemePositioning | null {
  for (const token of tagTokens(tags)) { const hit = EXACT_TAG[token.toLowerCase()]; if (hit) return hit; }
  return null;
}

export function positioningFromTags(tags: string | null | undefined): SchemePositioning | null {
  return exactPositioningTag(tags) || (tagTokens(tags).some(t => /\b(luxury|prime)\b/i.test(t)) ? "luxury" : null);
}

// The tags string with the positioning set (null = back to automatic).
export function withPositioningTag(tags: string | null | undefined, positioning: SchemePositioning | null): string {
  const kept = tagTokens(tags).filter(t => !EXACT_TAG[t.toLowerCase()]);
  return [...kept, ...(positioning ? [positioning] : [])].join(", ");
}

type BrandFacts = { name: string; companyType?: string | null; industry?: string | null; description?: string | null; storeCount?: number | null };

// Quick-service and mass-market chains a description alone doesn't give away
// ("American premium burger chain" is still Five Guys).
const MASS_MARKET = /^(kfc|burger king|popeyes|taco bell|five guys|krispy kreme|mcdonald'?s|subway|domino'?s(?: pizza)?|pizza hut|papa john'?s|greggs|wingstop|slim chickens|wendy'?s|jollibee|chicken cottage|german doner kebab|tim hortons|chopstix|pret a manger|costa(?: coffee)?|starbucks|caffe nero|caffè nero)$/i;
const MASS_TEXT = /\bqsr\b|fast[- ]food|quick[- ]service|drive[- ]thru|\bbudget\b|\bdiscount(?:er)?\b|\bvalue (?:fashion |clothing |home )?retailer|meal deals?/i;
const LUXURY_TYPE = /luxury|jewell?ery|watches|fine dining/i;
const LUXURY_TEXT = /\bluxury\b|\bhaute\b|couture|high[- ]end|michelin|fine[- ]dining|fine jewell?ery|watchmak|\bmaison\b/i;
const PREMIUM_TEXT = /\bpremium\b|upscale|speciality|specialty|artisan|chef[- ]led|\bboutique\b|elevated|high[- ]quality|award[- ]winning/i;

export function brandTier(b: BrandFacts): BrandTier {
  const text = `${b.industry || ""} ${b.description || ""}`;
  if (/quick service|qsr|fast food/i.test(b.companyType || "") || MASS_MARKET.test(b.name.trim()) || MASS_TEXT.test(text)) return "mass";
  // A chain this size is mass-market whatever its copy says.
  if ((b.storeCount || 0) >= 300 && isClientCrmCategory(b.companyType)) return "mass";
  if (LUXURY_TYPE.test(b.companyType || "") || LUXURY_TEXT.test(text)) return "luxury";
  if (PREMIUM_TEXT.test(text)) return "premium";
  return null;
}

const HOTEL_NAME = /\b(hotels?|inns?|lodge|resorts?)\b|^(ihg|travelodge|premier inn|hilton|marriott|accor|whitbread|hyatt|radisson|holiday inn)\b/i;
const HOTEL_TEXT = /\bhotel(?:s| chain| group| brand| company| operator)\b|\bbudget hotel|\d[\d,]* (?:hotel )?rooms\b/i;
export const isHotelGroup = (b: BrandFacts) => HOTEL_NAME.test(b.name) || /hotel/i.test(b.industry || "") || HOTEL_TEXT.test(b.description || "");

// Does a brand belong on this scheme's board at all?
export function fitsPositioning(positioning: SchemePositioning, b: { companyType?: string | null; tier: BrandTier; hotel: boolean }): boolean {
  const hospitality = isClientCrmCategory(b.companyType);
  if (positioning === "luxury") {
    if (b.hotel || b.tier === "mass") return false;
    return hospitality || (/^tenant/i.test(b.companyType || "") && (b.tier === "luxury" || b.tier === "premium"));
  }
  if (positioning === "value") return hospitality && b.tier !== "luxury";
  return hospitality;
}

// Ranking lift for the brands a luxury scheme is really after.
export const positioningBoost = (positioning: SchemePositioning, tier: BrandTier) =>
  positioning !== "luxury" ? 0 : tier === "luxury" ? 20 : tier === "premium" ? 10 : 0;

// With no tag, the current tenants decide: most of them luxury / premium
// brands reads as luxury. Value is only ever set by tag — a small parade of
// chains shouldn't quietly re-position a scheme.
export function positioningFromTenants(tiers: BrandTier[]): SchemePositioning | null {
  if (tiers.length < 3) return null;
  const upscale = tiers.filter(t => t === "luxury" || t === "premium").length;
  return upscale * 2 > tiers.length && tiers.includes("luxury") ? "luxury" : null;
}

// Retail sectors for a luxury scheme's board, checked before the F&B ones.
export const LUXURY_RETAIL_SECTORS: Array<{ key: string; label: string; rx: RegExp }> = [
  { key: "jewellery_watches", label: "Jewellery & watches", rx: /jewell?er|jewelry|\bwatch(?:es|maker|making| retailer)\b|diamond|goldsmith/i },
  { key: "luxury_fashion", label: "Fashion & accessories", rx: /fashion|couture|ready-to-wear|leather goods|handbags?|tailor|menswear|womenswear|\bshoes\b|footwear|cashmere|knitwear|apparel|clothing|accessories/i },
  { key: "beauty_fragrance", label: "Beauty & fragrance", rx: /beauty|skin ?care|fragrance|perfum|cosmetic|candle/i },
  { key: "gifting_lifestyle", label: "Gifting & lifestyle", rx: /department store|food hall|hamper|\bgifts?\b|gifting|stationer|homeware|home scent|lifestyle|chocolat|confection|wine merchant|bookshop|art gallery/i },
];
