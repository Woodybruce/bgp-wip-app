// A better company type for a brand on a catch-all type, so it sorts into
// the right category of Landsec's agency brief (Woody, 2026-11-16: "go ahead
// with the catagories"). Rules only, no AI: the brand's name first, then its
// description and industry. A suggestion is offered only where it moves the
// brand into a different category; an admin ticks what to apply
// (server/brand-retype.ts). A type a person chose (Casual Dining, Gym, ...)
// is never second-guessed: only the catch-all types below are read.
import { landsecCategoryOf } from "./landsec";

// Retail types are left out: a fashion brand named "Gym King" is not a gym.
export const CATCH_ALL_TENANT_TYPES = [
  "Tenant", "Tenant - Leisure", "Tenant - Experiential", "Tenant - Entertainment", "Tenant - Gaming",
  "Tenant - Family Entertainment", "Tenant - Family", "Tenant - Restaurant", "Tenant - F&B", "Tenant - Food & Drink",
] as const;

export const isCatchAllTenantType = (type: string | null | undefined): boolean =>
  (CATCH_ALL_TENANT_TYPES as readonly string[]).some(t => t.toLowerCase() === String(type || "").trim().toLowerCase());

interface RetypeRule { type: string; name?: RegExp; text?: RegExp }

// In order: the first rule that matches wins, so the narrow ones come first
// (a "food hall" before food, "escape rooms" before "experience").
const RULES: RetypeRule[] = [
  { type: "Tenant - Theme & Water Park", name: /\b(therme|legoland|sea life|wet ?'?n'? ?wild|aquapark)\b/i, text: /\b(water ?park|theme park|aqua ?park|aquarium)\b/i },
  { type: "Tenant - Food Hall", name: /\b(kerb|boxpark|mercato metropolitano|time out market|eataly|seven dials market|market halls|dinerama|bang bang oriental)\b/i, text: /\b(food hall|market hall|street food market)\b/i },
  { type: "Tenant - Cinema", name: /\b(cinemas?|odeon|cineworld|everyman|picturehouse|curzon|showcase cinemas?|imax)\b|^vue\b/i, text: /\b(cinemas?|multiplex)\b/i },
  { type: "Tenant - Competitive Socialising",
    name: /\b(flight club|puttshack|boom battle|electric shuffle|bounce|hijingo|swingers|lane ?7|roxy (ball room|lanes)|all star lanes|hollywood bowl|tenpin|bowlplex|superbowl|junkyard golf|puttery|topgolf|f1 arcade|fairgame|lucky voice|clays|oche|whistle punks|hatchet harry'?s|escape hunt|immersive gamebox|toca social)\b/i,
    text: /\b(competitive socialis\w*|social entertainment|crazy golf|mini golf|adventure golf|darts|bowling|ten-?pin|karaoke|escape rooms?|axe throwing|shuffleboard|ping pong|table tennis|curling)\b/i },
  { type: "Tenant - Active Leisure",
    name: /\b(padel|gravity|clip ?'?n'? ?climb|ifly|flip ?out|airhop|boulder\w*|climbing|powerleague|goals soccer|go ?karts?|karting)\b/i,
    text: /\b(padel|climbing|bouldering|trampolin\w*|indoor skydiv\w*|ninja course|karting|go-?karts?|skate ?park|ice rink|surf park|five-a-side)\b/i },
  { type: "Tenant - Soft Play", name: /\b(soft ?play|play ?centre|tiny town|gymboree|kidzania|playzone)\b/i, text: /\b(soft ?play|children'?s play|kids'? play|play ?centre)\b/i },
  { type: "Tenant - Immersive Experience", name: /\b(immersive|museum|illusions?)\b/i,
    text: /\b(immersive|interactive experience|exhibition|museum|illusions|virtual reality|vr experience|comedy club|live music venue)\b/i },
  { type: "Tenant - Wellness", name: /\b(spa|wellness|cryo\w*|sauna|bathhouse)\b/i, text: /\b(day spa|wellness centre|cryotherapy|flotation|sauna|bathhouse)\b/i },
  { type: "Tenant - Yoga", name: /\b(yoga|pilates|reformer)\b/i, text: /\b(yoga|pilates)\b/i },
  { type: "Tenant - Gym",
    name: /\b(gym|gymbox|puregym|anytime fitness|david lloyd|virgin active|nuffield health|everlast|third space|bannatyne'?s?|barry'?s|f45|1rebel)\b/i,
    text: /\b(gym|fitness (club|studio|centre)|boutique fitness)\b/i },
  { type: "Tenant - Bakery", name: /\b(bakery|bakehouse|patisserie|greggs|gail'?s|krispy kreme|doughnuts?|donuts?|cinnabon|ole ?& ?steen)\b/i, text: /\b(bakery|patisserie|doughnuts?)\b/i },
  { type: "Tenant - Café",
    name: /\b(coffee|caf[eé]|espresso|costa|starbucks|caffe nero|pret|joe & the juice|black sheep|blank street|watch ?house|tea|juice|smoothie|gelato|ice cream|frozen yogh?urt|bubble tea)\b/i,
    text: /\b(coffee shop|coffee house|caf[eé]|espresso bar|tea room|juice bar|bubble tea|gelato|ice cream parlou?r)\b/i },
  { type: "Tenant - Quick Service",
    name: /\b(kfc|mcdonald'?s|burger king|popeyes|wingstop|five guys|shake shack|subway|jersey mike'?s|taco bell|chipotle|tortilla|pizza hut|domino'?s|papa john'?s|german doner kebab|chopstix|itsu|wasabi|leon|tossed|panda express|chick-?fil-?a|jollibee|wendy'?s|smashburger|wimpy)\b/i,
    text: /\b(quick service|quick-service|fast food|qsr|grab and go|grab & go)\b/i },
];

export interface RetypeBrand { name: string; companyType: string | null; industry?: string | null; description?: string | null }
export interface RetypeSuggestion { type: string; reason: string }

// The suggestion for one brand, or null: not on a catch-all type, no rule
// matches, or the match would leave it in the category it is in.
export function suggestTenantType(brand: RetypeBrand): RetypeSuggestion | null {
  if (!isCatchAllTenantType(brand.companyType)) return null;
  const name = String(brand.name || "");
  const text = [brand.description, brand.industry].filter(Boolean).join(" ");
  const now = landsecCategoryOf(brand.companyType);
  for (const rule of RULES) {
    const byName = rule.name?.exec(name);
    const byText = byName ? null : rule.text?.exec(text);
    const hit = byName || byText;
    if (!hit) continue;
    if (landsecCategoryOf(rule.type) === now) return null;
    return { type: rule.type, reason: `${byName ? "Name" : "Description"} says “${hit[0]}”` };
  }
  return null;
}
