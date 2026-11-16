// Landsec workspace constants shared by server and client
// (docs/landsec-pitch-plan.md). The brief categories are the Hospitality &
// Leisure categories of the instruction; the four London schemes also take
// all retail.
export const LANDSEC_BRIEF_CATEGORIES = [
  "Restaurants & Bars",
  "Café, Grab & Go and QSR",
  "Food Halls",
  "Competitive Socialising",
  "Active Leisure",
  "Gyms, Wellness & Softplay",
  "Cinema",
  "Immersive & Entertainment",
  "Major Project Leisure",
  "Retail (London schemes)",
] as const;
export type LandsecBriefCategory = (typeof LANDSEC_BRIEF_CATEGORIES)[number];

// The categories of Landsec's H&L agency brief (October 2026), as the Landsec
// view sorts brands by them (Woody, 2026-11-16: "go ahead with the
// catagories"; only the Landsec view uses them, BGP's own Brands groups keep
// theirs). The lead agency's six, the leisure consultant's three, and retail,
// which the brief takes at the four London schemes only. A brand's category is
// read from its company type, never stored; "other" is a type that names no
// category (a bare "Tenant", "Tenant - Leisure"), for the admin re-typing tool
// to sort.
export const LANDSEC_CATEGORIES = [
  { key: "restaurants_bars", label: "Restaurants & Bars", group: "Hospitality", brief: "Restaurants & Bars" },
  { key: "cafe_qsr", label: "Café, Grab & Go and QSR", group: "Hospitality", brief: "Café, Grab & Go and QSR" },
  { key: "food_halls", label: "Food Halls", group: "Hospitality", brief: "Food Halls" },
  { key: "competitive_socialising", label: "Competitive Socialising", group: "Leisure", brief: "Competitive Socialising" },
  { key: "active_leisure", label: "Active Leisure", group: "Leisure", brief: "Active Leisure" },
  { key: "gyms_wellness_softplay", label: "Gyms, Wellness & Softplay", group: "Leisure", brief: "Gyms, Wellness & Softplay" },
  { key: "cinema", label: "Cinema", group: "Cinema & entertainment", brief: "Cinema" },
  { key: "immersive", label: "Immersive & Entertainment", group: "Cinema & entertainment", brief: "Immersive & Entertainment" },
  { key: "major_leisure", label: "Major Project Leisure", group: "Cinema & entertainment", brief: "Major Project Leisure" },
  { key: "retail", label: "Retail", group: "London retail", brief: "Retail (London schemes)" },
] as const;
export type LandsecCategoryKey = (typeof LANDSEC_CATEGORIES)[number]["key"];
export type LandsecCategoryOrOther = LandsecCategoryKey | "other";
export const LANDSEC_CATEGORY_GROUPS = ["Hospitality", "Leisure", "Cinema & entertainment", "London retail"] as const;
export const LANDSEC_OTHER_LABEL = "Other";

// Every company type the app holds or has held, by category. The Brands hub's
// own lists name the variants that came in from imports ("Tenant - Pub",
// "Tenant - QSR"), so they are here too.
export const LANDSEC_CATEGORY_TYPES: Record<LandsecCategoryKey, readonly string[]> = {
  restaurants_bars: ["Tenant - Fine Dining", "Tenant - Casual Dining", "Tenant - Restaurant", "Tenant - Food & Drink", "Tenant - F&B", "Tenant - Bar", "Tenant - Pub", "Tenant - Wine Bar"],
  cafe_qsr: ["Tenant - Café", "Tenant - Coffee", "Tenant - Café & Coffee", "Tenant - Quick Service", "Tenant - Fast Casual", "Tenant - Fast Food", "Tenant - QSR", "Tenant - Bakery", "Tenant - Patisserie"],
  food_halls: ["Tenant - Food Hall", "Tenant - Market Hall"],
  competitive_socialising: ["Tenant - Competitive Socialising", "Tenant - Gaming", "Tenant - Escape Room", "Tenant - Bowling", "Tenant - Arcade"],
  active_leisure: ["Tenant - Active Leisure", "Tenant - Padel"],
  gyms_wellness_softplay: ["Tenant - Gym", "Tenant - Fitness", "Tenant - Gym & Fitness", "Tenant - Health & Fitness", "Tenant - Wellness", "Tenant - Spa", "Tenant - Yoga", "Tenant - Pilates", "Tenant - Soft Play", "Tenant - Family Entertainment", "Tenant - Family", "Tenant - Kids Entertainment"],
  cinema: ["Tenant - Cinema", "Tenant - Cinema & Film"],
  immersive: ["Tenant - Immersive Experience", "Tenant - Immersive", "Tenant - Experiential", "Tenant - Entertainment", "Tenant - Arts", "Tenant - Culture", "Tenant - Gallery"],
  major_leisure: ["Tenant - Theme & Water Park", "Tenant - Theme Park", "Tenant - Water Park"],
  retail: [
    "Tenant - Luxury", "Tenant - Luxury Accessories", "Tenant - Luxury Beauty", "Tenant - Flagship Fashion", "Tenant - Fashion",
    "Tenant - Athleisure", "Tenant - Sportswear", "Tenant - Footwear", "Tenant - Accessories & Footwear", "Tenant - Jewellery & Watches",
    "Tenant - Beauty", "Tenant - Skincare", "Tenant - Fragrance", "Tenant - Homewares", "Tenant - Lifestyle & Home", "Tenant - Gifts & Perfumes",
    "Tenant - Department Store", "Tenant - Technology", "Tenant - Electronics", "Tenant - Tech", "Tenant - Automotive", "Tenant - Cars",
    "Tenant - Telecoms", "Tenant - Telecommunications", "Tenant - Grocery", "Tenant - Convenience", "Tenant - Supermarket",
    "Tenant - Books & Stationery", "Tenant - Books", "Tenant - Stationery", "Tenant - Financial Services", "Tenant - Bank", "Tenant - Finance",
    "Tenant - Services", "Tenant - Optician", "Tenant - Travel", "Tenant - Other Services", "Tenant - Hair", "Tenant - Nails", "Tenant - Aesthetics",
    "Tenant - Value Retail", "Tenant - Discount", "Tenant - Pound Store", "Tenant - Trade", "Tenant - DIY", "Tenant - Hardware",
    "Tenant - Builders Merchants", "Tenant - National Retail", "Tenant - High Street", "Tenant - Retail", "Tenant - General Retail",
    "Tenant - Activation",
  ],
};

const LANDSEC_TYPE_INDEX = new Map<string, LandsecCategoryKey>(
  (Object.entries(LANDSEC_CATEGORY_TYPES) as Array<[LandsecCategoryKey, readonly string[]]>)
    .flatMap(([key, types]) => types.map(t => [t.toLowerCase(), key] as [string, LandsecCategoryKey])));

// A type the lists above do not hold, by the words in it. Order matters:
// "Food Hall" before "food", "Soft Play" before "play".
const LANDSEC_TYPE_WORDS: Array<[RegExp, LandsecCategoryKey]> = [
  [/food hall|market hall/, "food_halls"],
  [/theme park|water park/, "major_leisure"],
  [/competitive|bowl|arcade|gaming|escape|darts|golf|karaoke|axe/, "competitive_socialising"],
  [/padel|climb|trampoline|active|karting|skate/, "active_leisure"],
  [/soft ?play|kids|family|gym|fitness|wellness|spa\b|yoga|pilates/, "gyms_wellness_softplay"],
  [/cinema|film/, "cinema"],
  [/immersive|experien|entertain|\barts?\b|culture|gallery|museum/, "immersive"],
  [/caf[eé]|coffee|bakery|patisserie|quick service|qsr|fast (food|casual)|grab/, "cafe_qsr"],
  [/restaurant|dining|\bbar\b|\bpub\b|food|drink|f&b/, "restaurants_bars"],
  [/retail|fashion|beauty|luxury|jewel|footwear|shoe|accessor|fragrance|skincare|home|gift|department|tech|electr|telecom|mobile|grocery|convenience|supermarket|book|stationer|financ|bank|service|optic|travel|hair|nail|aesthetic|discount|value|pound|trade|diy|hardware|sport|athleisure|toy|pet\b|pharm|vape/, "retail"],
];

// A brand's category by its company type. null = not a tenant brand
// (a landlord, an agent, no type); "other" = a tenant whose type names no
// category ("Tenant", "Tenant - Leisure", "Tenant - Hotel").
export function landsecCategoryOf(companyType: string | null | undefined): LandsecCategoryOrOther | null {
  const type = String(companyType || "").trim();
  if (!/^tenant\b/i.test(type)) return null;
  const known = LANDSEC_TYPE_INDEX.get(type.toLowerCase());
  if (known) return known;
  const words = type.replace(/^tenant\s*-?\s*/i, "").toLowerCase();
  if (!words || words === "leisure") return "other";
  for (const [rule, key] of LANDSEC_TYPE_WORDS) if (rule.test(words)) return key;
  return "other";
}

export function landsecCategoryLabel(key: LandsecCategoryOrOther | null | undefined): string | null {
  if (!key) return null;
  if (key === "other") return LANDSEC_OTHER_LABEL;
  return LANDSEC_CATEGORIES.find(c => c.key === key)?.label ?? null;
}

// The company types that sort into one category, for a query or a picker.
export function landsecCategoryTypes(key: LandsecCategoryKey): readonly string[] {
  return LANDSEC_CATEGORY_TYPES[key];
}

export type LandsecBriefSigner = "leasing" | "am";

// The one line of the older two-signature brief a role login signs, or null
// where the login signs either (BGP staff, a Landsec login with no role).
// This is the role as a label, not a limit on what the login sees: an asset
// manager signs as the asset manager and a leasing manager as the leasing
// manager. The server refuses the other line and the unit page does not
// offer it. A joint agent signs neither (refused on the server).
export function landsecBriefSignerOnly(role: string | null | undefined): LandsecBriefSigner | null {
  if (role === "asset_manager") return "am";
  if (role === "leasing_manager") return "leasing";
  return null;
}

export interface LandsecAgreedBrief {
  use: string | null;
  category: string | null;
  nerFloor: number | null;          // net effective rent floor, £ pa
  incentiveCeiling: string | null;  // e.g. "12 months rent free, no capital contribution"
  capexEnvelope: number | null;     // £
  targetBrands: string | null;
  notes: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  leasing: { by: string | null; at: string | null };
  am: { by: string | null; at: string | null };
}

export function briefStatus(b: LandsecAgreedBrief | null | undefined): "agreed" | "awaiting_am" | "awaiting_leasing" | "unsigned" | "empty" {
  if (!b) return "empty";
  const hasContent = !!(b.use || b.category || b.nerFloor || b.incentiveCeiling || b.capexEnvelope || b.targetBrands);
  if (!hasContent) return "empty";
  if (b.leasing.at && b.am.at) return "agreed";
  if (b.leasing.at) return "awaiting_am";
  if (b.am.at) return "awaiting_leasing";
  return "unsigned";
}

// ── Deal clock (item 4) ─────────────────────────────────────────────────
export const LANDSEC_WAITING_PARTIES = [
  "Landsec asset manager",
  "Landsec leasing manager",
  "Landsec approval (CAPR / board)",
  "Tenant",
  "Tenant's agent",
  "Landsec solicitors",
  "Tenant's solicitors",
  "BGP",
  "Joint agent",
  "Another deal",
] as const;

export interface LandsecDealClock {
  waitingOnParty: string | null;
  waitingOnName: string | null;
  waitingSince: string | null;
  waitingNote: string | null;
  dependsOnDealId: string | null;
  dependsOn?: { id: string; ref: number | null; name: string; unit: string | null } | null;
  // True when the deal depends on one the viewer cannot see: the screens say
  // "another deal" and the id and name are not sent.
  dependsOnHidden?: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
}

// ── One set of numbers (docs/landsec-menu-plan-2026-11-12.md, part 7) ────
// A live letting is a letting-type deal at Marketing, Negotiating, HOTs or
// Solicitors, counted from the deal. Stuck is a deal in negotiation that has
// sat at its stage for LANDSEC_STUCK_DAYS: Marketing is left out, because
// every tracker unit has a Marketing deal and those are voids, not deals.
export const LANDSEC_LIVE_STAGES = ["AVA", "NEG", "HOT", "SOL"] as const;
export type LandsecLiveStage = (typeof LANDSEC_LIVE_STAGES)[number];
export const LANDSEC_STUCK_STAGES: readonly LandsecLiveStage[] = ["NEG", "HOT", "SOL"];
export const LANDSEC_STUCK_DAYS = 30;

// A deal in negotiation: past Marketing and not yet exchanged. These are the
// only stages that can be stuck, and the only ones chased for "who is it
// waiting on".
export const landsecInNegotiation = (code: string | null | undefined): boolean =>
  !!code && (LANDSEC_STUCK_STAGES as readonly string[]).includes(code);
export const landsecIsStuck = (code: string | null | undefined, days: number | null | undefined): boolean =>
  landsecInNegotiation(code) && days != null && days >= LANDSEC_STUCK_DAYS;

// What landsecCounts (server/landsec-counts.ts) works out for a set of
// properties. The last three say where the Letting Tracker and the deals
// disagree: the tracker shows trackerRows, Deals shows liveLettings.
export interface LandsecCount {
  stages: Record<LandsecLiveStage, number>;
  liveLettings: number;
  liveDeals: number;                 // every open deal on the properties, lettings or not
  stuck: number;                     // every open deal in negotiation for 30 days, a letting or not (as Deals counts it)
  oldestStageDays: number | null;    // the longest a deal in negotiation has sat at its stage
  trackerRows: number;               // tracker rows at one of the four stages
  rowsWithoutLetting: number;        // of those, rows with no live letting behind them
  lettingsWithoutRow: number;        // live lettings no tracker row points at
}

// Net Effective Rent as Landsec defines it: the headline rent less the
// annual cost of the incentives spread over the MINIMUM term — the term
// certain to the first break — not the full lease.
//   NER pa = (headline × (termCertain − rentFreeYears) − capital) / termCertain
export interface LandsecNer {
  nerPa: number;
  headlinePa: number;
  termCertainYears: number;
  rentFreeMonths: number;
  capital: number;
  assumedTerm: boolean;
}

// With no rent free and no capital recorded the sum above returns the
// headline rent, which reads as a deal that meets its floor. A 0 counts as
// recorded (it says there is none); a blank does not. The screens then say
// "incentives not recorded" and give no pass or fail.
export const landsecIncentivesRecorded = (...values: unknown[]): boolean =>
  values.some(v => v !== null && v !== undefined && v !== "");

// How a deal's Net Effective Rent sits against the brief's floor.
// "unchecked" = there is a floor, but the incentives are not recorded.
export type LandsecBriefCheck = "pass" | "fail" | "unchecked" | null;
export function landsecBriefCheck(nerPa: number | null | undefined, floor: number | null | undefined, incentivesRecorded: boolean): LandsecBriefCheck {
  if (nerPa == null || floor == null || !floor) return null;
  if (!incentivesRecorded) return "unchecked";
  return nerPa >= floor ? "pass" : "fail";
}

const numIn = (s: string | number | null | undefined): number | null => {
  if (s === null || s === undefined || s === "") return null;
  const m = String(s).replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

// "10 years", "10 yrs", "10" → 10. Break: "5th year", "year 5", "5", "break at year 5",
// "mutual break 2031" (a year, not a term — ignored).
export function termCertainYears(leaseLength: string | number | null | undefined, breakOption: string | null | undefined): { years: number; assumed: boolean } {
  const full = numIn(leaseLength);
  const b = (breakOption || "").toLowerCase();
  let brk: number | null = null;
  if (b && !/\bno\b|none|n\/a/.test(b)) {
    const m = b.match(/(\d+(\.\d+)?)/);
    if (m) {
      const v = parseFloat(m[1]);
      brk = v > 0 && v < 100 ? v : null; // a calendar year ("2031") is not a term
    }
  }
  if (full && brk && brk < full) return { years: brk, assumed: false };
  if (brk && !full) return { years: brk, assumed: false };
  if (full) return { years: full, assumed: false };
  return { years: 5, assumed: true };
}

export function landsecNer(input: {
  headlinePa: number | null | undefined;
  rentFreeMonths?: number | null;
  capital?: number | null;
  leaseLength?: string | number | null;
  breakOption?: string | null;
  termYears?: number | null;
}): LandsecNer | null {
  const headlinePa = Number(input.headlinePa);
  if (!headlinePa || headlinePa < 1000) return null;
  const tc = input.termYears && input.termYears > 0 ? { years: input.termYears, assumed: false } : termCertainYears(input.leaseLength, input.breakOption);
  const rentFreeMonths = Math.max(0, Number(input.rentFreeMonths) || 0);
  const rentFreeYears = Math.min(rentFreeMonths / 12, tc.years);
  const capital = Math.max(0, Number(input.capital) || 0);
  const nerPa = (headlinePa * (tc.years - rentFreeYears) - capital) / tc.years;
  if (!Number.isFinite(nerPa)) return null;
  return { nerPa: Math.round(nerPa), headlinePa: Math.round(headlinePa), termCertainYears: tc.years, rentFreeMonths, capital, assumedTerm: tc.assumed };
}

// ── Brand case (item 5) ─────────────────────────────────────────────────
export const LANDSEC_CASE_RESPONSES = [
  { key: "seen", label: "Seen" },
  { key: "supportive", label: "Supportive" },
  { key: "concerns", label: "Concerns" },
  { key: "visit", label: "Wants a store visit" },
] as const;
export type LandsecCaseResponse = (typeof LANDSEC_CASE_RESPONSES)[number]["key"];

export interface LandsecCaseEvidence { id: string; kind: "photo" | "video" | "link" | "file"; url: string; caption: string | null; fileKey?: string | null; mimeType?: string | null }
export interface LandsecCaseUnit { id: string; schemeKey: string; schemeName?: string; tenancyUnitId: string | null; unitLabel: string; note: string | null; status: string | null }

// ── Logins by role and scheme (item 6) ──────────────────────────────────
export const LANDSEC_ROLES = [
  { key: "leasing_manager", label: "Landsec leasing manager", scope: "the schemes ticked on the login, or all of them when none is ticked" },
  { key: "asset_manager", label: "Landsec asset manager", scope: "the schemes ticked on the login, or all of them when none is ticked" },
  { key: "joint_agent", label: "Joint agent", scope: "full control of the letting work on their schemes only; no brand pages, BGP contacts, email history or fees" },
] as const;
export type LandsecRole = (typeof LANDSEC_ROLES)[number]["key"];
// The roles held to the schemes on their login and to their own pages. An
// asset manager is not one of them (Woody, 2026-11-13: "asset managers and
// leasing landsec should be the same"): for access that role is a full
// Landsec login, and the schemes on it only say which ones the person
// answers for.
// Since 14 November 2026 no role is restricted to its own front door: a
// joint agent uses the same app as a Landsec login, cut to its schemes
// (landsecLoginSchemes), and is kept off brand pages and BGP's own records by
// jointAgentApiDenied below (Woody: "the only difference is the lack of
// access to the brands page"). The list stays for the code that still reads
// it; restrictedLandsecApiRule now only opens, for a joint agent, what its
// own pages and chat reached before (server/landsec-access.ts).
export const RESTRICTED_LANDSEC_ROLES: LandsecRole[] = [];

// What a joint agent may not reach that a Landsec login may: brand pages and
// the brand hub, company records and their contacts (BGP's brand contacts),
// brand cases, the correspondence log, the generated Targeting Brief (BGP's notes on targets) and making a CRM
// requirement from a viewing. The company LIST stays open: it is what a
// brand picker reads (a name to pick, never a page).
export function jointAgentApiDenied(method: string, path: string): boolean {
  const p = String(path || "").toLowerCase().split("?")[0];
  if (/^\/api\/(brand|brands|brand-crm|brand-pack|covenant\/by-crm)(\/|$)/.test(p)) return true;
  // Its chat stays its own (server/chat-joint-agent.ts): the addresses that
  // chat uses are opened one by one by restrictedLandsecApiRule, every other
  // chat or ChatBGP door is shut.
  if (/^\/api\/(chat|chatbgp|chat-media)(\/|$)/.test(p)) return true;
  if (/^\/api\/crm\/companies\/[^/]+/.test(p)) return true;
  if (/^\/api\/crm\/contacts(\/|$)/.test(p)) return true;
  // The CRM plan (strategies, events, actions on brands) and landlord records.
  if (/^\/api\/crm\/engagement(\/|$)/.test(p)) return true;
  if (/^\/api\/(landlord|landlords|crm\/landlords)\//.test(p)) return true;
  if (/^\/api\/interactions(\/|$)/.test(p)) return true;
  if (/^\/api\/landsec\/brand-case(\/|$)/.test(p)) return true;
  if (/^\/api\/landsec\/brand-crm\/plan\/[^/]+/.test(p)) return true;
  if (/^\/api\/unit-briefs\/[^/]+\/generate-document$/.test(p)) return true;
  if (/^\/api\/leasing-viewings\/[^/]+\/requirement$/.test(p)) return true;
  if (String(method).toUpperCase() === "DELETE" && /^\/api\/available-units\/[^/]+$/.test(p)) return true;
  return false;
}
// What a login sees (Woody, 2026-11-14: "log in for people from landsec with
// access only to their properties and the same for joint agents. The only
// difference is the lack of access to the brands page"; asked, "list or ALL"
// and "whole schemes"). The schemes ticked on a login limit it; a Landsec
// login with none ticked, or with no role row, sees all of them. A joint
// agent always has a list, and a joint agent with none sees nothing. Null =
// every scheme. The caller filters the keys to real schemes.
export function landsecLoginSchemes(access: { role: string; schemes: string[] | null } | null | undefined): string[] | null {
  if (!access) return null;
  const list = (access.schemes || []).map(String).filter(Boolean);
  if (access.role === "joint_agent") return list;
  return list.length ? list : null;
}
// A role row must hold one of the three roles, spelt exactly. The table has
// no check on the column, so a row written by hand with any other value
// ("joint-agent", "JOINT_AGENT") is refused wherever the role is read: it is
// never read as a full Landsec login.
export const isKnownLandsecRole = (role: unknown): role is LandsecRole =>
  typeof role === "string" && LANDSEC_ROLES.some(r => r.key === role);
export const UNKNOWN_LANDSEC_ROLE_ERROR = "This login's Landsec role is not recognised";

// The API a joint agent login may reach (the only role this is asked for:
// restrictedLandsecApiDecision in server/landsec-access.ts). The answer is
// final at the gateway (server/index.ts): nothing on the ordinary client
// lists applies to that login, so every rule carries its own limits.
// Until 13 November 2026 an asset manager was judged here too, and its brand
// reads answered a third way, "client" (on to the ordinary client checks,
// after a review found "allow" let it read a rival landlord's records). An
// asset manager is a full Landsec login now (Woody, 2026-11-13: "asset
// managers and leasing landsec should be the same"), so the ordinary client
// gateway judges every request it makes and this rule holds nothing for it.
// Reaching a route is not the permission: each handler behind these paths
// checks the scheme. A joint agent has full control of the letting work on
// their schemes (Woody, 2026-11-12): the tracker unit, its interest,
// viewings and offers, the viewings calendar, share with a brand and their
// own tasks (read and tick). Never the unit list, the firm-wide aggregates,
// deleting a unit, the CRM requirement made from a viewing, or the generated
// Targeting Brief document.
// Of the config addresses only the maps key the browser draws with: the
// other one (/api/config/os-key) hands out a key the server pays for.
const RESTRICTED_COMMON = ["/api/landsec/", "/api/heartbeat", "/api/client/brand-theme", "/api/push/", "/api/config/maps-key", "/api/notifications"];
const UNIT_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const JOINT_AGENT_UNIT = new RegExp(`^/api/available-units/${UNIT_ID}$`);
const JOINT_AGENT_UNIT_ACTIVITY = new RegExp(`^/api/available-units/${UNIT_ID}/(interest|viewings|offers)$`);
const JOINT_AGENT_ACTIVITY_ITEM = /^\/api\/available-units\/(interest|viewings|offers)\/[^/]+$/;
const JOINT_AGENT_CHAT_THREAD = new RegExp(`^/api/chat/threads/${UNIT_ID}$`);
const JOINT_AGENT_CHAT_MESSAGES = new RegExp(`^/api/chat/threads/${UNIT_ID}/messages$`);
const JOINT_AGENT_CHAT_MESSAGE = new RegExp(`^/api/chat/threads/${UNIT_ID}/messages/${UNIT_ID}$`);
const JOINT_AGENT_CHAT_ACTIVE_RUN = new RegExp(`^/api/chatbgp/threads/${UNIT_ID}/active-run$`);
const JOINT_AGENT_CHAT_CANCEL_RUN = new RegExp(`^/api/chatbgp/threads/${UNIT_ID}/cancel-run$`);
const JOINT_AGENT_BRIEF_DRAFT = new RegExp(`^/api/available-units/${UNIT_ID}/brief/draft-ai$`);
const JOINT_AGENT_PROPERTY = new RegExp(`^/api/crm/properties/${UNIT_ID}$`);
const JOINT_AGENT_DEAL = new RegExp(`^/api/crm/deals/${UNIT_ID}$`);
const JOINT_AGENT_SCHEDULE = new RegExp(`^/api/tenancy-schedule/property/${UNIT_ID}(/links)?$`);
const JOINT_AGENT_PROPERTY_PARTS = new RegExp(`^/api/properties/${UNIT_ID}/(plans|brochures|schemes)$`);
const JOINT_AGENT_PROPERTY_UNITS = new RegExp(`^/api/properties/${UNIT_ID}/units(/(tracker(:|%3a))?${UNIT_ID})?$`);
const JOINT_AGENT_PLAN_MATCH = new RegExp(`^/api/plans/${UNIT_ID}/match$`);

// The path a gate mounted on "/api" must judge: the one the router matches
// the request on. Never cut it out of req.originalUrl. The router stops a
// path at "#" as well as "?", so "/api/available-units/#/files" is routed to
// the unit list, and a gate reading the text up to "?" let it in as one
// unit's files.
// Reading req.path can throw on a request line that is not an address at all
// ("/api//x@y[/foo#" reads as a broken host name). The router matches no
// route for such a request, so the answer is the empty path: no rule allows
// it, and a gate must not turn it into a server error.
// The same answer when the path read here is not the one typed on the
// request line. Below a mount the router re-reads what is left of the line,
// and with a "#" in it the slower reader takes over: it turns "\" into "/"
// and reads "//user@host" as a host, so "/api\a@b/landsec/home#" came out
// here as "/api/landsec/home" while the routes were matched on
// "/api/a@b/landsec/home" (review, 2026-11-13; it reached only "Not found").
// Two readings of one request are never judged: the gate refuses.
export function routedApiPath(req: { baseUrl?: string; path?: string; originalUrl?: string }): string {
  try {
    const routed = `${req.baseUrl || ""}${req.path || ""}`.replace(/\/+$/, "");
    if (typeof req.originalUrl === "string") {
      const typed = req.originalUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "").split(/[?#]/)[0].replace(/\/+$/, "");
      if (typed !== routed) return "";
    }
    return routed;
  } catch {
    return "";
  }
}

export function restrictedLandsecApiRule(role: LandsecRole, method: string, path: string): "allow" | "deny" {
  const p = path.toLowerCase().replace(/\/+$/, "");
  const m = method.toUpperCase();
  const hit = (list: string[]) => list.some(pre => pre.endsWith("/") ? p.startsWith(pre) : (p === pre || p.startsWith(pre + "/")));
  const jointAgent = role === "joint_agent";
  if (hit(RESTRICTED_COMMON)) {
    // Joint agents never see brand cases (BGP's brand work).
    if (jointAgent && p.startsWith("/api/landsec/brand-case")) return "deny";
    return "allow";
  }
  // The generated Targeting Brief document carries BGP's notes on the
  // target brands: a joint agent does not make it.
  if (jointAgent && /^\/api\/unit-briefs\/[^/]+\/generate-document$/.test(p)) return "deny";
  // The Targeting Brief on their own schemes (server/unit-brief-workspace.ts):
  // the brief, its people, comments and sign-off, the unit's files, and the
  // plan and brochure files a brief links to. Every handler checks the
  // scheme with briefAccess.
  if (p === "/api/unit-briefs" || p.startsWith("/api/unit-briefs/")) return "allow";
  // The negotiation log, the Heads of Terms, the deal checklist and the
  // transaction recommendation on their own schemes: every handler checks
  // the scheme with briefAccess.
  if (p.startsWith("/api/unit-offers/") || p.startsWith("/api/unit-hots/") || p.startsWith("/api/deal-checklists/") || p.startsWith("/api/unit-recommendations/")) return "allow";
  if (/^\/api\/available-units\/[^/]+\/(brief|files)$/.test(p)) return "allow";
  // The people pickers read the names of the people on the account.
  if (m === "GET" && p === "/api/users") return "allow";
  if (/^\/api\/available-units\/files\/[^/]+$/.test(p)) return "allow";
  if (m === "GET" && (/^\/api\/plans\/[^/]+\/image$/.test(p) || /^\/api\/properties\/[^/]+\/brochures\/[^/]+\/file$/.test(p))) return "allow";
  if (jointAgent) {
    // Share with a brand (server/unit-share.ts).
    if (p.startsWith("/api/unit-share/")) return "allow";
    // Add a unit, and read or change one unit. Not the list, not a delete.
    if (m === "POST" && p === "/api/available-units") return "allow";
    if ((m === "GET" || m === "PATCH") && JOINT_AGENT_UNIT.test(p)) return "allow";
    // Interest, viewings and offers on a unit, and one line of each.
    if (JOINT_AGENT_UNIT_ACTIVITY.test(p) || JOINT_AGENT_ACTIVITY_ITEM.test(p)) return "allow";
    if (m === "POST" && JOINT_AGENT_BRIEF_DRAFT.test(p)) return "allow";
    // The viewings calendar. Making a CRM requirement from a viewing stays
    // with BGP.
    if (m === "GET" && (p === "/api/leasing-viewings" || p === "/api/leasing-viewings/options" || p === "/api/leasing-viewings/report")) return "allow";
    if (m === "PATCH" && /^\/api\/leasing-viewings\/[^/]+$/.test(p)) return "allow";
    if (m === "POST" && (/^\/api\/leasing-viewings\/[^/]+\/units$/.test(p) || /^\/api\/leasing-viewings\/[^/]+\/offers\/[^/]+\/confirm$/.test(p))) return "allow";
    // Comments not yet logged (server/letting-suggestions.ts): read the list
    // and the count, and mark one as logged or dismissed. Nothing else under
    // the path. Every handler checks the scheme, and a suggestion made from a
    // target's comments (BGP's notes) is never listed or counted for them.
    if (m === "GET" && (p === "/api/letting-suggestions" || p === "/api/letting-suggestions/count")) return "allow";
    if (m === "POST" && /^\/api\/letting-suggestions\/[^/]+\/(confirm|dismiss)$/.test(p)) return "allow";
    // Chat (Woody, 2026-11-13: "yes go ahead"). Each address is opened by
    // itself, by method: never a prefix. Reaching one is not the permission:
    // the handlers hold a joint agent to its own conversations, the people
    // it may talk to and tags at its schemes (server/chat-joint-agent.ts),
    // and its ChatBGP to a fixed set of read tools
    // (server/chatbgp-joint-agent.ts). Still closed: members after a
    // conversation is made, renaming and linking, search, the media drawer,
    // group pictures, drafts, files to ChatBGP and every other ChatBGP door.
    if ((m === "GET" || m === "POST") && p === "/api/chat/threads") return "allow";
    // A property's one shared conversation: opening the box joins it. The
    // handler checks the property (its own schemes, or a shared centre page).
    if (m === "POST" && /^\/api\/chat\/threads\/record\/property\/[^/]+$/.test(p)) return "allow";
    if ((m === "GET" || m === "DELETE") && JOINT_AGENT_CHAT_THREAD.test(p)) return "allow";
    if (m === "POST" && JOINT_AGENT_CHAT_MESSAGES.test(p)) return "allow";
    if ((m === "PUT" || m === "DELETE") && JOINT_AGENT_CHAT_MESSAGE.test(p)) return "allow";
    if (m === "GET" && (p === "/api/chat/notifications" || p === "/api/chat/tag-search")) return "allow";
    if (m === "POST" && p === "/api/chat/upload") return "allow";
    if (m === "GET" && /^\/api\/chat-media\/[^/]+$/.test(p)) return "allow";
    if (m === "GET" && p === "/api/chatbgp/status") return "allow";
    if (m === "POST" && p === "/api/chatbgp/chat") return "allow";
    if (m === "GET" && JOINT_AGENT_CHAT_ACTIVE_RUN.test(p)) return "allow";
    if (m === "POST" && JOINT_AGENT_CHAT_CANCEL_RUN.test(p)) return "allow";
    // The real Properties and Deals pages (Woody, 2026-11-14: "joint agent
    // can do anything other than see brands"), read only and at its own
    // schemes: each handler cuts the list to the schemes, refuses a record
    // off them and leaves out BGP's own fields
    // (JOINT_AGENT_HIDDEN_PROPERTY_FIELDS / JOINT_AGENT_HIDDEN_DEAL_FIELDS).
    // Never the brand list, contacts, a deal's or property's emails,
    // activity, tasks, targets or brand gap, and no writes here.
    if (m === "GET") {
      if (p === "/api/crm/properties" || JOINT_AGENT_PROPERTY.test(p)) return "allow";
      if (p === "/api/crm/deals" || JOINT_AGENT_DEAL.test(p)) return "allow";
      if (JOINT_AGENT_SCHEDULE.test(p)) return "allow";
      if (JOINT_AGENT_PROPERTY_PARTS.test(p)) return "allow";
      // The plan-led property page (Woody, 2026-11-14: "Joint agents need to
      // be on new layout"): the unit list, one unit, and a plan's outlines.
      // Read only; the handlers check the scheme (propertyReadBlocked) and cut
      // BGP's compliance record and brand links (server/property-units.ts).
      if (JOINT_AGENT_PROPERTY_UNITS.test(p) || JOINT_AGENT_PLAN_MATCH.test(p)) return "allow";
      // A folder or file in the data room: the handler holds a joint agent to
      // the folders of its own schemes' properties (client-sharepoint.ts).
      if (p === "/api/client/sharepoint/list" || p === "/api/client/sharepoint/content") return "allow";
      // Public property data on the property page (price paid, VOA, EPC, flood, planning).
      if (p === "/api/property-lookup") return "allow";
    }
  }
  // Their own task list (Woody, 2026-11-13: "we need each person to have
  // this update their own task list"): read it and tick a task. Nothing else
  // under /api/tasks: no create, delete, reorder, import or notebook link.
  // An asset manager has the ordinary client task list, as a full Landsec
  // login does.
  if (m === "GET" && p === "/api/tasks") return "allow";
  if (m === "PATCH" && /^\/api\/tasks\/[^/]+$/.test(p)) return "allow";
  return "deny";
}

// What a request is about, when it is about one property's page (Woody,
// 2026-11-14: "the app is for everyone to be able to amend including the
// client and the joint agents ... Everything is the same"). A joint agent's
// request that the rule above refuses is let on to the ordinary client checks
// when it is about a property at one of its own schemes: the property itself,
// or a plan, plan outline or schedule row of one (looked up by the server).
// Brand pages are not here and stay closed (Woody: "anything other than see
// brands").
export type JointAgentPropertyRef = { kind: "property" | "plan" | "plan-unit" | "tenancy-unit" | "leasing-unit" | "review-item"; id: string };
export function jointAgentPropertyRef(path: string, query: Record<string, unknown> = {}): JointAgentPropertyRef | null {
  const p = path.replace(/\/+$/, "");
  const id = (m: RegExpMatchArray | null) => (m && m[1] && m[1].length <= 80 ? m[1] : null);
  let m: string | null;
  if ((m = id(p.match(/^\/api\/(?:properties|property)\/([^/]+)(?:\/|$)/i)))) return { kind: "property", id: m };
  if ((m = id(p.match(/^\/api\/crm\/properties\/([^/]+)(?:\/|$)/i)))) return { kind: "property", id: m };
  if ((m = id(p.match(/^\/api\/(?:tenancy|leasing)-schedule\/property\/([^/]+)(?:\/|$)/i)))) return { kind: "property", id: m };
  if ((m = id(p.match(/^\/api\/plans\/([^/]+)(?:\/|$)/i)))) return { kind: "plan", id: m };
  if ((m = id(p.match(/^\/api\/plan-units\/([^/]+)$/i)))) return { kind: "plan-unit", id: m };
  if ((m = id(p.match(/^\/api\/tenancy-schedule\/unit\/([^/]+)(?:\/|$)/i)))) return { kind: "tenancy-unit", id: m };
  if ((m = id(p.match(/^\/api\/leasing-schedule\/units?\/([^/]+)(?:\/|$)/i)))) return { kind: "leasing-unit", id: m };
  if ((m = id(p.match(/^\/api\/review-items\/([^/]+)\/resolve$/i)))) return { kind: "review-item", id: m };
  const q = typeof query.propertyId === "string" ? query.propertyId : null;
  if (q && q.length <= 80 && /^\/api\/(activity-summary|lease-events|client\/sharepoint\/property-root)$/i.test(p)) return { kind: "property", id: q };
  return null;
}

// A joint agent on the real Properties and Deals pages (Woody, 2026-11-14:
// "joint agent can do anything other than see brands", with BGP's own
// records kept private). It opens the properties and deals at its own
// schemes; these are the fields it is never sent on them: BGP's notes and
// commentary, who at BGP covers it, BGP's contacts, the fee, invoicing and
// Xero, and the compliance record. Fee and AML fields also go through the
// client fee strip first. A new BGP-only column goes on the list.
export const JOINT_AGENT_HIDDEN_PROPERTY_FIELDS = [
  // Since 14 November 2026 a joint agent sees a property as any Landsec login
  // does (Woody: "Everything is the same"); only the compliance record and
  // BGP's billing and system links stay out.
  "proprietor_kyc_status", "proprietor_kyc_data", "billing_entity_id", "monday_item_id",
] as const;
export const JOINT_AGENT_HIDDEN_DEAL_FIELDS = [
  // BGP's team and its people on the deal are NOT on this list since 15
  // November 2026 (Woody: "Landsec can change, as can joint agent"): a joint
  // agent reads and sets them as a Landsec login does.
  "comments", "last_interaction", "last_contact_at", "last_contact_source", "fee_notes", "group_name",
  "fee", "fee_percentage", "fee_agreement", "fee_agreement_url", "fee_currency",
  "invoicing_email", "invoicing_notes", "po_number", "xero_contact_id", "xero_contact_name",
  "xero_account_number", "xero_billing_address", "client_contact_id", "landlord_contact_id",
  "tenant_contact_id", "vendor_contact_id", "purchaser_contact_id", "vendor_agent_contact_id",
  "acquisition_agent_contact_id", "purchaser_agent_contact_id", "leasing_agent_contact_id",
  "joint_agent_contact_id", "sharepoint_link", "monday_item_id", "deal_scope", "bgp_acting_for",
  "kyc_approved", "kyc_approved_at", "kyc_approved_by", "aml_check_completed", "aml_checklist",
  "mlr_scope", "mlr_scope_reason", "mlr_scope_assessed_at", "mlr_scope_assessed_by", "aml_mlro_report_url",
  "aml_sof_analysis", "aml_ai_triage", "aml_market_data", "solicitor_notes",
] as const;

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// The row without the listed fields, whether it carries them in snake_case
// (raw SQL) or camelCase (Drizzle), and without any aml_ column.
export function withoutJointAgentFields<T extends Record<string, any>>(row: T, fields: readonly string[]): T {
  const out: Record<string, any> = { ...row };
  for (const f of fields) { delete out[f]; delete out[snakeToCamel(f)]; }
  for (const k of Object.keys(out)) if (/^aml(_|[A-Z])/.test(k)) delete out[k];
  return out as T;
}
