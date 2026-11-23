// BGP's Anti-Money Laundering Policy (Issue 3, November 2026) and Firm-Wide
// Risk Assessment (Issue 2, November 2026), as the rules the app applies.
// Issue 3 of the policy is Issue 2 with the four changes Jack signed off on
// 23 November 2026: companies evidenced from Companies House with BGP's
// screening (4.1, 4.2, 4.4, 4.6); a certified digital identity check counts as
// meeting the person (4.10, 4.11); a newly formed company (4.4); and the
// Deputy Nominated Officers (C.b). The rest below was written from Issue 2. Woody, 19 November 2026:
// "can you consider these and add into the AML as required", and, asked,
// the same day:
//   - the deal's agents sign off a standard-risk party; the Nominated
//     Officer or the Deputy decides an enhanced one (the risk assessment:
//     "The completed checks are then reviewed and approved by the relevant
//     fee earners. Higher risk clients are referred to the Nominated or
//     Deputy Nominated Officer");
//   - restaurants and bars are a factor to weigh, not enhanced due
//     diligence; the risk assessment's own list of cash-intensive businesses
//     (plus casinos, nightclubs, mining and dual-use manufacturers) is;
//   - a deal that exchanges or completes with checks outstanding still moves,
//     and the Nominated Officer and the Deputy are emailed;
//   - the other side of a deal can be marked "Not required" (a joint agent
//     negotiated it, or no deal was done), by the Nominated Officer or the
//     Deputy only.
// Pure rules: the server reads the records (server/aml-policy.ts,
// server/kyc-red-flags.ts, server/deal-party-aml.ts).

import type { KycRedFlag } from "./kyc-red-flags";
import { ownerRegister, tradingState, type KycPrecheckResult } from "./kyc-prechecks";
import { isInvestmentDeal } from "./deal-status";
import { foundationMarkInName } from "./deal-parties";
import { ALL_LETTING_TYPES, TENANT_REP_TYPES } from "./letting-rules";

// ── The documents ───────────────────────────────────────────────────────────

export interface AmlPolicyDocument { key: string; title: string; issue: number; date: string; file: string }

// Kept with every earlier issue (policy M: policies and the risk assessment
// are kept for five years from their review, older versions included). A new
// issue is a new entry and a new file; never overwrite an old one.
export const AML_POLICY_DOCUMENTS: readonly AmlPolicyDocument[] = [
  { key: "policy-issue-3", title: "Anti-Money Laundering Policy", issue: 3, date: "November 2026", file: "bgp-aml-policy-issue-3.docx" },
  { key: "policy-issue-2", title: "Anti-Money Laundering Policy", issue: 2, date: "November 2026", file: "bgp-aml-policy-issue-2.docx" },
  { key: "risk-assessment-issue-2", title: "Firm-Wide Anti-Money Laundering Risk Assessment", issue: 2, date: "November 2026", file: "bgp-firm-wide-aml-risk-assessment-issue-2.docx" },
  { key: "checklist-trusts", title: "AML checklist: trusts", issue: 1, date: "November 2026", file: "bgp-aml-checklist-trusts.docx" },
];

// ── Checklists for enhanced due diligence ───────────────────────────────────
// BGP's AML checklist for trusts (Jack, 20 November 2026), item for item: what
// KYC4U is asked for on a trust, and what the officers' second read looks for.
export interface AmlChecklistItem { n: number; title: string; detail: string }
export const TRUST_CHECKLIST: readonly AmlChecklistItem[] = [
  { n: 1, title: "Trust deed", detail: "A certified copy of the trust deed, confirming the form of the trust, the settlor(s), the trustees, the beneficiaries and any protector or other person with control (sections 4.7 and 3.12)." },
  { n: 2, title: "Trust Registration Service", detail: "Evidence that the trust is registered with HMRC, with a copy of the registration kept on file (section 4.7)." },
  { n: 3, title: "Structure chart", detail: "If the trust holds the asset through one or more companies, a chart showing the ownership up to the trust (section 3.7.1)." },
  { n: 4, title: "Settlor(s)", detail: "Identity verification, and evidence of source of wealth: the original funds placed in the trust must not be tainted (section 4.7)." },
  { n: 5, title: "Trustees", detail: "Identity verification of each trustee; a professional trust company is checked as a company (sections 4.4 and 4.7)." },
  { n: 6, title: "Protector", detail: "Identity verification, where one is appointed (section 4.7)." },
  { n: 7, title: "Beneficiaries", detail: "Not required if the trust is discretionary; if not, identity verification of any beneficiary entitled to 25% or more (section 4.7)." },
  { n: 8, title: "Authority to instruct", detail: "Confirmation that the instruction comes from the trustees, or from someone with their written authority (section 3.7.4)." },
  { n: 9, title: "Source of funds", detail: "Source of funds for this transaction, including the identity of any third party providing funding (sections 3.7.5 and 3.7.6)." },
  { n: 10, title: "Screening", detail: "Sanctions, PEP and adverse media checks on the trust and on every individual named above (sections 3.13 and 4.12)." },
  { n: 11, title: "Nominated Officer sign-off", detail: "A file note recording the risk level and the reasons for it (sections 3.11 and H)." },
];
export const TRUST_PERSON_EVIDENCE = "For each individual: one valid photo ID (passport or photocard driving licence) and one proof of address no more than 3 months old (utility bill, bank statement or council tax demand). Copies for non-UK residents, or for anyone we have not met, must be certified (sections 4.10, 4.11 and 3.12).";

// Any other enhanced party: what the officers' second read looks for (BGP's
// AML policy, Issue 2, sections 3.7 and F.a).
export const ENHANCED_CHECKLIST: readonly AmlChecklistItem[] = [
  { n: 1, title: "Identity of the party", detail: "The company verified from its register (or the person's photo ID), and who is acting for it with their authority." },
  { n: 2, title: "Beneficial owners", detail: "Everyone owning or controlling more than 25%, through any chain of companies, identified and verified; a structure chart where there is a chain." },
  { n: 3, title: "Each person's ID and address", detail: "One valid photo ID and one proof of address no more than 3 months old for each beneficial owner and the person acting." },
  { n: 4, title: "Source of funds", detail: "Where the money for this transaction comes from, with evidence, and who provides it." },
  { n: 5, title: "Source of wealth", detail: "How the owners came by their wealth, where the risk calls for it (a PEP, a high-risk country, a large sum)." },
  { n: 6, title: "The higher-risk factor", detail: "What made it enhanced (the red flag or policy factor) and how it was resolved or why it is acceptable." },
  { n: 7, title: "Screening", detail: "Sanctions, PEP and adverse media checks on the party and every person named." },
  { n: 8, title: "Nominated Officer sign-off", detail: "A file note recording the risk level and the reasons for it (sections 3.11 and H)." },
];

/** The trust checklist as lines (the officers' second read; KYC4U's note until 23 November 2026). */
export function trustChecklistNote(): string {
  return ["TRUST: BGP's AML checklist for trusts, please collect and review in full:",
    ...TRUST_CHECKLIST.filter(i => i.n <= 10).map(i => `${i.n}. ${i.title}: ${i.detail}`),
    TRUST_PERSON_EVIDENCE].join("\n");
}
export const amlPolicyDocument = (key: unknown): AmlPolicyDocument | null =>
  AML_POLICY_DOCUMENTS.find(d => d.key === String(key ?? "")) || null;
/** A document a later issue of the same title replaced (kept for five years, policy M). */
export const amlPolicyDocumentReplaced = (d: AmlPolicyDocument): boolean =>
  AML_POLICY_DOCUMENTS.some(o => o.title === d.title && o.issue > d.issue);

// ── The officers (policy C.b and D) ─────────────────────────────────────────

// Who the policy names (Issue 3, C.b). The app holds who is set (AML
// settings); these are only what "Use the policy's officers" looks for. Since
// 20 November 2026 there can be more than one Deputy (Woody: "jack as officer
// and then layla and i as depituties"), set in the AML policy panel; Issue 3
// names both Deputies (Issue 2 named Victoria Broadhead).
export const POLICY_OFFICER_NAMES: { readonly nominated: string; readonly deputies: readonly string[] } = {
  nominated: "Jack Barratt", deputies: ["Layla O'Driscoll", "Woody Bruce"],
};
export const MAX_AML_DEPUTIES = 3;

export interface AmlOfficer { id: string | null; name: string | null; email: string | null }
export interface AmlOfficers { nominated: AmlOfficer | null; deputies: AmlOfficer[] }
export type AmlOfficerRole = "nominated" | "deputy" | "admin";

const lower = (v: unknown): string => String(v ?? "").trim().toLowerCase();
const isOfficer = (o: AmlOfficer | null, user: { id?: string | null; email?: string | null }): boolean =>
  !!o && ((!!o.id && !!user.id && o.id === user.id) || (!!o.email && lower(o.email) === lower(user.email)));

/**
 * The Deputies as stored (system_settings.aml_deputy_officer): a list since
 * 20 November 2026 ({ deputies: [...] }), one officer before ({ id, name,
 * email }). Anything else reads as none.
 */
export function readDeputies(value: unknown): AmlOfficer[] {
  const one = (v: any): AmlOfficer | null => v && typeof v === "object" && (v.id || v.email)
    ? { id: v.id ? String(v.id) : null, name: v.name ? String(v.name) : null, email: v.email ? String(v.email) : null } : null;
  const v = value as any;
  const list = v && typeof v === "object" && Array.isArray(v.deputies) ? v.deputies.map(one) : [one(v)];
  return list.filter((x: AmlOfficer | null): x is AmlOfficer => !!x).slice(0, MAX_AML_DEPUTIES);
}

/**
 * The AML role of a signed-in user: the Nominated Officer, the Deputy, or an
 * admin acting while no Nominated Officer is set (the gap stays visible: every
 * refusal says none is set). Null for anyone else.
 */
export function amlOfficerRole(user: { id?: string | null; email?: string | null } | null, officers: AmlOfficers, isAdmin: boolean): { role: AmlOfficerRole | null; appointed: boolean } {
  const appointed = !!(officers.nominated && (officers.nominated.id || officers.nominated.email));
  if (!user) return { role: null, appointed };
  if (isOfficer(officers.nominated, user)) return { role: "nominated", appointed };
  if (officers.deputies.some(d => isOfficer(d, user))) return { role: "deputy", appointed };
  if (!appointed && isAdmin) return { role: "admin", appointed };
  return { role: null, appointed };
}

/** "the Nominated Officer (Jack Barratt) or a Deputy (Layla O'Driscoll or Woody Bruce)", as set. */
export function officerWords(officers: AmlOfficers): string {
  const n = officers.nominated?.name;
  if (!officers.nominated) return "an admin, until a Nominated Officer is set in the AML policy panel";
  const names = officers.deputies.map(d => d.name).filter((x): x is string => !!x);
  const deputies = !officers.deputies.length ? ""
    : officers.deputies.length === 1 ? ` or the Deputy${names.length ? ` (${names[0]})` : ""}`
    : ` or a Deputy${names.length ? ` (${names.join(" or ")})` : ""}`;
  return `the Nominated Officer${n ? ` (${n})` : ""}${deputies}`;
}

/** The Deputies' names for a line: "Layla O'Driscoll and Woody Bruce". */
export function deputyNames(officers: Pick<AmlOfficers, "deputies">): string {
  const names = officers.deputies.map(d => d.name).filter((x): x is string => !!x);
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ── Levels of due diligence (policy F.a) and re-checks (policy H.a) ─────────

export type DueDiligenceLevel = "simplified" | "standard" | "enhanced";
export const DUE_DILIGENCE_LABEL: Record<DueDiligenceLevel, string> = {
  simplified: "Simplified due diligence",
  standard: "Standard due diligence",
  enhanced: "Enhanced due diligence",
};

// Standard risk (simplified or standard) 3 years; high risk or sanctions
// (enhanced) 1 year.
export const RECHECK_YEARS: Record<DueDiligenceLevel, number> = { simplified: 3, standard: 3, enhanced: 1 };

export function recheckDate(level: DueDiligenceLevel, from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + RECHECK_YEARS[level]);
  return d;
}

export interface PartyDueDiligence {
  level: DueDiligenceLevel;
  // Why, in plain words: the simplified basis, or the enhanced reasons.
  why: string[];
  // Factors the risk assessment says to weigh that do not by themselves
  // need enhanced due diligence (restaurants and bars, car parks).
  toWeigh: string[];
  recheckYears: number;
}

/**
 * The level for a party: enhanced when any red flag or higher-risk factor
 * counts (one set aside with a comment does not), simplified when the policy's
 * basis for it holds and nothing makes it enhanced, otherwise standard.
 */
export function dueDiligenceLevel(input: {
  partyFlags: Array<Pick<KycRedFlag, "label" | "factor">>;
  dealFlags: Array<Pick<KycRedFlag, "label" | "factor">>;
  simplifiedBasis: string | null;
  toWeigh?: string[];
}): PartyDueDiligence {
  const all = [...input.partyFlags, ...input.dealFlags.map(f => ({ ...f, label: `On the transaction: ${f.label}` }))];
  if (all.length) {
    return { level: "enhanced", why: all.map(f => f.label), toWeigh: input.toWeigh || [], recheckYears: RECHECK_YEARS.enhanced };
  }
  if (input.simplifiedBasis) {
    return { level: "simplified", why: [input.simplifiedBasis], toWeigh: input.toWeigh || [], recheckYears: RECHECK_YEARS.simplified };
  }
  return { level: "standard", why: ["No higher-risk factor found: identify and verify the beneficial owners."], toWeigh: input.toWeigh || [], recheckYears: RECHECK_YEARS.standard };
}

// ── Which checks a deal needs (policy A) ────────────────────────────────────

export type AmlRegime = "full" | "sanctions_only" | "advisory";
export const LETTING_AML_MONTHLY_RENT = 10_000;

/**
 * Sales and purchases: full checks on every party. Lettings of a month or
 * more at £10,000 a month or more: full checks (MLR 2017). Lettings under
 * that: sanctions checks on every party (SAML 2018), the owners identified and
 * screened, not verified. Rent not recorded: full checks. Advisory work (rent
 * reviews, dilapidations, service charge) is not agency work.
 */
export function amlRegime(deal: { dealType?: string | null; team?: string[] | string | null; rentPa?: number | string | null }): { regime: AmlRegime; why: string } {
  const type = String(deal.dealType || "").trim();
  if (isInvestmentDeal(type, deal.team ?? null)) return { regime: "full", why: "A sale or purchase: full checks on every party." };
  if (/^(rent review|dilapidations|service charge)$/i.test(type)) {
    return { regime: "advisory", why: `${type} is advisory work, not estate or letting agency: the policy's checks are for sales, purchases and lettings.` };
  }
  const letting = ALL_LETTING_TYPES.includes(type) || (TENANT_REP_TYPES as readonly string[]).includes(type) || /^(lease renewal|regear)$/i.test(type);
  if (!letting) return { regime: "full", why: "Full checks on every party." };
  const rent = Number(deal.rentPa);
  if (!Number.isFinite(rent) || rent <= 0) return { regime: "full", why: "A letting with no rent recorded: full checks until the rent shows it is under £10,000 a month." };
  if (rent / 12 >= LETTING_AML_MONTHLY_RENT) return { regime: "full", why: `A letting at £${Math.round(rent / 12).toLocaleString("en-GB")} a month: full checks on every party.` };
  return { regime: "sanctions_only", why: `A letting at £${Math.round(rent / 12).toLocaleString("en-GB")} a month: sanctions checks only. The owners are screened, and no client documents are needed.` };
}

// ── Countries (risk assessment: geography; policy appendix 3.2) ─────────────

// The UK's high-risk third countries are FATF's two lists as they stand
// (MLR 2017 reg 33(3), since SI 2024/69): enhanced due diligence is required
// by law. FATF reviews them each February, June and October: update these
// lists and the date after each plenary.
export const FATF_LISTS_AS_OF = "30 October 2026";
const FATF_CALL_FOR_ACTION = ["Iran", "North Korea", "Myanmar"];
const FATF_INCREASED_MONITORING = [
  "Angola", "Bolivia", "Bosnia and Herzegovina", "Cameroon", "Haiti", "Iraq", "Kenya", "Kuwait", "Laos", "Lebanon",
  "Nepal", "Papua New Guinea", "South Sudan", "Syria", "Venezuela", "Vietnam", "British Virgin Islands", "Yemen",
];
// The risk assessment's Eurasia and Africa row: countries the UK authorities
// link to overseas corruption and fraud laundered through UK property.
const FWRA_EURASIA_AFRICA = [
  "Russia", "Belarus", "Kazakhstan", "Kyrgyzstan", "Ukraine", "Tajikistan", "Turkmenistan", "Uzbekistan",
  "Azerbaijan", "Georgia", "Armenia", "Angola", "Ghana", "Nigeria", "China", "Pakistan",
];
// Countries that sell citizenship by investment (the risk assessment:
// "Where UBOs are citizens of a country that has a CBI scheme, enhanced due
// diligence will be applied").
const CBI_COUNTRIES = [
  "Antigua and Barbuda", "Dominica", "Grenada", "Saint Kitts and Nevis", "Saint Lucia", "Vanuatu",
  "Turkey", "Egypt", "Jordan", "Cambodia", "Nauru", "Sao Tome and Principe",
];

// What the registers write for each country: names, and nationalities as a
// person's record gives them. "Dominican" is left out (it is also the
// Dominican Republic's).
const COUNTRY_WORDS: Record<string, string[]> = {
  "Iran": ["iran", "islamic republic of iran", "iran, islamic republic of", "iranian"],
  "North Korea": ["north korea", "dprk", "democratic people's republic of korea", "korea, democratic people's republic of", "north korean"],
  "Myanmar": ["myanmar", "burma", "burmese"],
  "Angola": ["angola", "angolan"],
  "Bolivia": ["bolivia", "plurinational state of bolivia", "bolivian"],
  "Bosnia and Herzegovina": ["bosnia and herzegovina", "bosnia", "bosnian", "bosnian and herzegovinian"],
  "Cameroon": ["cameroon", "cameroonian"],
  "Haiti": ["haiti", "haitian"],
  "Iraq": ["iraq", "iraqi"],
  "Kenya": ["kenya", "kenyan"],
  "Kuwait": ["kuwait", "kuwaiti"],
  "Laos": ["laos", "lao pdr", "lao people's democratic republic", "lao", "laotian"],
  "Lebanon": ["lebanon", "lebanese"],
  "Nepal": ["nepal", "nepalese", "nepali"],
  "Papua New Guinea": ["papua new guinea", "papua new guinean"],
  "South Sudan": ["south sudan", "south sudanese"],
  "Syria": ["syria", "syrian arab republic", "syrian"],
  "Venezuela": ["venezuela", "bolivarian republic of venezuela", "venezuelan"],
  "Vietnam": ["vietnam", "viet nam", "vietnamese"],
  "British Virgin Islands": ["british virgin islands", "virgin islands, british", "virgin islands (british)", "bvi", "tortola"],
  "Yemen": ["yemen", "yemeni"],
  "Russia": ["russia", "russian federation", "russian"],
  "Belarus": ["belarus", "belarusian", "belarussian"],
  "Kazakhstan": ["kazakhstan", "kazakh", "kazakhstani"],
  "Kyrgyzstan": ["kyrgyzstan", "kyrgyz republic", "kyrgyz", "kyrgyzstani"],
  "Ukraine": ["ukraine", "ukrainian"],
  "Tajikistan": ["tajikistan", "tajik", "tajikistani"],
  "Turkmenistan": ["turkmenistan", "turkmen"],
  "Uzbekistan": ["uzbekistan", "uzbek", "uzbekistani"],
  "Azerbaijan": ["azerbaijan", "azerbaijani", "azeri"],
  "Georgia": ["georgia", "georgian"],
  "Armenia": ["armenia", "armenian"],
  "Ghana": ["ghana", "ghanaian"],
  "Nigeria": ["nigeria", "nigerian"],
  "China": ["china", "people's republic of china", "prc", "chinese"],
  "Pakistan": ["pakistan", "pakistani"],
  "Antigua and Barbuda": ["antigua and barbuda", "antigua", "antiguan", "barbudan", "antiguan and barbudan"],
  "Dominica": ["dominica", "commonwealth of dominica"],
  "Grenada": ["grenada", "grenadian"],
  "Saint Kitts and Nevis": ["saint kitts and nevis", "st kitts and nevis", "st. kitts and nevis", "kittitian", "nevisian", "kittitian and nevisian"],
  "Saint Lucia": ["saint lucia", "st lucia", "st. lucia", "saint lucian", "st lucian"],
  "Vanuatu": ["vanuatu", "ni-vanuatu", "vanuatuan"],
  "Turkey": ["turkey", "turkiye", "republic of turkiye", "turkish"],
  "Egypt": ["egypt", "egyptian"],
  "Jordan": ["jordan", "jordanian"],
  "Cambodia": ["cambodia", "cambodian"],
  "Nauru": ["nauru", "nauruan"],
  "Sao Tome and Principe": ["sao tome and principe", "sao tomean", "santomean"],
};

const norm = (v: unknown): string => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/** The country a register's words name: the whole text, or any part of it between commas or slashes. */
export function countryOf(text: unknown): string | null {
  const whole = norm(text);
  if (!whole) return null;
  const parts = [whole, ...whole.split(/[,/;()]/).map(p => p.trim()).filter(Boolean)];
  for (const [country, words] of Object.entries(COUNTRY_WORDS)) {
    if (parts.some(p => words.includes(p))) return country;
  }
  return null;
}

export type CountryRisk = "fatf_call_for_action" | "fatf_increased_monitoring" | "fwra_eurasia_africa";
export function countryRisk(country: string | null): CountryRisk | null {
  if (!country) return null;
  if (FATF_CALL_FOR_ACTION.includes(country)) return "fatf_call_for_action";
  if (FATF_INCREASED_MONITORING.includes(country)) return "fatf_increased_monitoring";
  if (FWRA_EURASIA_AFRICA.includes(country)) return "fwra_eurasia_africa";
  return null;
}
export const sellsCitizenship = (country: string | null): boolean => !!country && CBI_COUNTRIES.includes(country);

const COUNTRY_RISK_WORDS: Record<CountryRisk, string> = {
  fatf_call_for_action: `on FATF's call for action list (${FATF_LISTS_AS_OF}): enhanced due diligence is required by law`,
  fatf_increased_monitoring: `on FATF's increased monitoring list (${FATF_LISTS_AS_OF}): a high-risk third country, so enhanced due diligence is required by law`,
  fwra_eurasia_africa: "named in BGP's risk assessment among the countries linked to corruption and fraud laundered through UK property: refer it to the Nominated Officer",
};

// ── Business sectors (policy appendix 3.1 and 3.6.3; risk assessment) ───────

interface SectorRule { key: string; label: string; enhanced: boolean; sic?: (code: string) => boolean; words?: RegExp }

const DUAL_USE_SIC = new Set([
  "20110", "20120", "20130", "20140", "20150", "20160", "20170", "20200", "20510", "20590", "20600",
  "24460", "25400", "26110", "26120", "26511", "26512", "26513", "26514", "30300", "30400",
]);
const isDualUseSic = (c: string) => DUAL_USE_SIC.has(c) || (/^28\d{3}$/.test(c) && c !== "28230");

const SECTOR_RULES: readonly SectorRule[] = [
  { key: "gambling", label: "Gambling (casinos, betting, bingo)", enhanced: true, sic: c => c === "92000", words: /\b(casinos?|betting|bookmakers?|bingo)\b/i },
  { key: "nightclub", label: "Nightclubs", enhanced: true, words: /\bnight ?clubs?\b/i },
  { key: "hair_beauty", label: "Hairdressers, barbers, nail bars, tanning and beauty salons", enhanced: true, sic: c => c === "96020",
    words: /\b(barbers?|barbershops?|hair ?dress(?:er|ers|ing)|hair salons?|nail (?:bars?|salons?)|tanning|beauty (?:salons?|parlou?rs?))\b/i },
  { key: "car_wash", label: "Car washes", enhanced: true, words: /\b(car ?wash(?:es)?|valeting)\b/i },
  { key: "vape", label: "Vape shops", enhanced: true, words: /\b(vapes?|vaping|e-?cig(?:arette)?s?)\b/i },
  { key: "candy", label: "American candy shops", enhanced: true, words: /\b(american (?:candy|sweets)|candy (?:shops?|stores?))\b/i },
  { key: "convenience", label: "Convenience stores", enhanced: true, words: /\b(convenience (?:stores?|shops?)|mini ?markets?|food (?:&|and) wine)\b/i },
  { key: "extractive", label: "Mining, quarrying, oil and gas", enhanced: true, sic: c => /^0[5-9]\d{3}$/.test(c) },
  { key: "dual_use", label: "Makes dual-use goods (machinery, chemicals, electronic components, carbon fibre): a proliferation financing risk", enhanced: true, sic: isDualUseSic },
  // To weigh, not enhanced (Woody, 19 November 2026).
  { key: "food_drink", label: "Restaurants, bars and pubs: cash-intensive, weigh how much is taken in cash", enhanced: false,
    sic: c => ["56101", "56102", "56103", "56301", "56302"].includes(c), words: /\b(restaurants?|bars?|pubs?|caf[eé]s?|quick service|casual dining|fine dining|takeaways?)\b/i },
  { key: "gaming", label: "Gaming venues: check they take no gambling stakes", enhanced: false, words: /\bgaming\b/i },
  { key: "car_park", label: "Car parks: cash-intensive", enhanced: false, words: /\bcar ?parks?\b/i },
];

/** The sector rules a party meets, from its Companies House SIC codes and BGP's type for the brand. */
export function sectorMatches(input: { sicCodes?: string[] | null; companyType?: string | null }): Array<{ key: string; label: string; enhanced: boolean; via: string }> {
  const sic = (input.sicCodes || []).map(c => String(c).trim()).filter(Boolean);
  // Accents off, so "Café" meets the same words as "Cafe".
  const type = String(input.companyType || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^tenant\s*-\s*/i, "").trim();
  const out: Array<{ key: string; label: string; enhanced: boolean; via: string }> = [];
  for (const rule of SECTOR_RULES) {
    const code = rule.sic ? sic.find(rule.sic) : undefined;
    const byType = !code && rule.words && type ? rule.words.test(type) : false;
    if (code) out.push({ key: rule.key, label: rule.label, enhanced: rule.enhanced, via: `SIC ${code}` });
    else if (byType) out.push({ key: rule.key, label: rule.label, enhanced: rule.enhanced, via: `BGP's type: ${type}` });
  }
  return out;
}

// ── Higher-risk factors as flags ────────────────────────────────────────────

export const POLICY_SOURCE = "BGP's AML policy (Issue 3) and risk assessment (Issue 2)";
const keyPart = (v: unknown) => norm(v).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
const POOLED_TYPES = new Set(["limited-partnership"]);
const ICVC_TYPES = new Set(["investment-company-with-variable-capital", "icvc-securities", "icvc-warrant", "icvc-umbrella"]);

/**
 * The policy's higher-risk factors a party meets, read from BGP's checks
 * before asking (the Companies House record) and BGP's type for the brand.
 * Each is a flag with `factor` set: it sends the party to enhanced due
 * diligence (KYC4U, then the Nominated Officer or the Deputy) as a red flag
 * does, and can be set aside with a comment where it does not apply.
 */
export function policyFactorFlags(input: { precheck?: KycPrecheckResult | null; companyType?: string | null; subjectType?: string | null }): KycRedFlag[] {
  const flags: KycRedFlag[] = [];
  const ch = input.precheck?.companiesHouse || null;
  const at = input.precheck?.ranAt || null;
  const base = { source: POLICY_SOURCE, at, factor: true as const };

  // A trust in the ownership (risk assessment: "Any property transaction
  // involving a trust should be treated as higher risk").
  const trustOwners = [
    ...(ch?.owners || []).filter(o => o.controls.some(c => /trust/i.test(c)) || /\btrustees?\b/i.test(o.name)).map(o => o.name),
    ...(ch?.peopleUpChain || []).filter(p => p.controls.some(c => /trust/i.test(c))).map(p => p.name),
  ];
  // A foundation in the ownership, on the register, abroad, or above a
  // company abroad in GLEIF (Woody, 21 November 2026): treated as a trust.
  const foundationOwners = [
    ...(ch?.owners || []).filter(o => o.kind !== "individual" && foundationMarkInName(o.name, { abroad: ownerRegister(o.country) === "abroad" })).map(o => o.name),
    ...(ch?.ownersAbroad || []).filter(o => foundationMarkInName(o.name, { abroad: true })).map(o => o.name),
    ...(input.precheck?.abroad?.traced || []).flatMap(t => t.gleif.parents)
      .filter(g => foundationMarkInName(g.name, { abroad: String(g.country || g.jurisdiction || "").toUpperCase().slice(0, 2) !== "GB" })).map(g => g.name),
  ];
  if (trustOwners.length || foundationOwners.length || /trust/i.test(String(input.subjectType || ""))) {
    const names = [...new Set([...trustOwners, ...foundationOwners])];
    const anyFoundation = foundationOwners.length > 0;
    flags.push({
      ...base, kind: "policy_trust",
      label: names.length ? `A ${anyFoundation && !trustOwners.length ? "foundation" : anyFoundation ? "trust or foundation" : "trust"} in the ownership: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}` : "The party is a trust or foundation",
      detail: anyFoundation
        ? "Ask for the foundation's charter and by-laws, its founder, the members of its board or council, any protector, and who benefits from it; for a trust, the trust deed, the settlor, trustees, any protector and beneficiaries of 25% or more, and its Trust Registration Service entry (policy 4.7)."
        : "Ask for the trust deed, the settlor, trustees, any protector and beneficiaries of 25% or more, and its Trust Registration Service entry (policy 4.7).",
      key: "policy:trust", evidence: names.length ? names.map(n => `owner:${keyPart(n)}`) : ["party:trust"],
      facts: names.map(n => ({ label: "Held for a trust", value: n })),
    });
  }

  // A limited partnership: a pooled vehicle, enhanced unless listed or regulated.
  if (ch?.type && POOLED_TYPES.has(ch.type) && !ch.listing) {
    flags.push({
      ...base, kind: "policy_pooled",
      label: `A limited partnership (${ch.name})`,
      detail: "Risk assessment: a pooled investment vehicle that is neither listed nor regulated is higher risk. Identify the general partner, the manager and investors of 25% or more; set this aside with a comment if its manager is FCA-regulated.",
      key: "policy:pooled", evidence: [`company:${keyPart(ch.number)}`],
      facts: [{ label: "Register", value: `${ch.name} (${ch.number}), ${ch.type.replace(/-/g, " ")}` }],
    });
  }

  // Countries: the party's own registered office, and its owners'.
  const seen = new Set<string>();
  const addCountry = (who: string, how: string, raw: unknown) => {
    const country = countryOf(raw);
    const risk = countryRisk(country);
    if (!country || !risk) return;
    const id = `${keyPart(who)}:${keyPart(country)}`;
    if (seen.has(id)) return;
    seen.add(id);
    flags.push({
      ...base, kind: "policy_country",
      label: `${who}: ${how} ${country}`,
      detail: `${country} is ${COUNTRY_RISK_WORDS[risk]}.`,
      key: `policy:country:${keyPart(country)}`, evidence: [`who:${id}`],
      facts: [{ label: country, value: COUNTRY_RISK_WORDS[risk] }],
    });
  };
  if (ch?.registeredOffice) {
    const parts = String(ch.registeredOffice).split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length) addCountry(ch.name, "registered in", parts[parts.length - 1]);
  }
  for (const o of ch?.owners || []) {
    if (o.kind === "individual") {
      addCountry(o.name, "a national of", o.nationality);
      addCountry(o.name, "lives in", o.residence);
    } else {
      addCountry(o.name, "registered in", o.country);
    }
  }
  // Owners who are citizens of a country that sells citizenship.
  for (const o of (ch?.owners || []).filter(x => x.kind === "individual")) {
    const country = countryOf(o.nationality);
    if (!sellsCitizenship(country)) continue;
    flags.push({
      ...base, kind: "policy_cbi",
      label: `${o.name}: a national of ${country}, which sells citizenship by investment`,
      detail: "Risk assessment: an owner from a country with a citizenship by investment scheme gets enhanced due diligence, to check it does not hide a sanctioned person.",
      key: `policy:cbi:${keyPart(country)}`, evidence: [`owner:${keyPart(o.name)}`],
      facts: [{ label: "Nationality on the register", value: String(o.nationality || country) }],
    });
  }

  // Business sectors the risk assessment names as higher risk.
  for (const s of sectorMatches({ sicCodes: ch?.sicCodes || [], companyType: input.companyType }).filter(m => m.enhanced)) {
    flags.push({
      ...base, kind: "policy_sector",
      label: s.label,
      detail: "Policy 3.6.3 and the risk assessment: an industry with an increased risk of being used for crime needs enhanced due diligence.",
      key: `policy:sector:${s.key}`, evidence: [`via:${keyPart(s.via)}`],
      facts: [{ label: "Read from", value: s.via }],
    });
  }
  return flags;
}

/** Factors the risk assessment says to weigh that are not enhanced by themselves. */
export function policyFactorsToWeigh(input: { precheck?: KycPrecheckResult | null; companyType?: string | null }): string[] {
  // A dormant, non-trading or newly formed company (Woody, 21 November 2026, "and 8").
  const trading = tradingState(input.precheck?.companiesHouse || null);
  return [
    ...sectorMatches({ sicCodes: input.precheck?.companiesHouse?.sicCodes || [], companyType: input.companyType })
      .filter(m => !m.enhanced).map(m => `${m.label} (${m.via})`),
    ...(trading.words ? [trading.words] : []),
  ];
}

const PUBLIC_BODY = /\b(council|london borough of|royal borough of|city of london corporation|greater london authority|transport for london|combined authority|nhs|ministry of|department (?:for|of)|homes england|police and crime commissioner|fire and rescue authority)\b/i;

/** The policy's basis for simplified due diligence, when the records show one. */
export function simplifiedBasis(input: { precheck?: KycPrecheckResult | null; partyName?: string | null }): string | null {
  const ch = input.precheck?.companiesHouse || null;
  const listing = ch?.listing || null;
  if (listing) {
    if (listing.viaParent) return `Owned through ${listing.company}, a company listed on a regulated market: simplified due diligence (policy 4.2), the chain confirmed by the officers.`;
    if (listing.market === "other_regulated" || listing.market === "listed_market") return `Listed on a market outside the UK and EU: simplified due diligence when that market is equivalent to the London Stock Exchange (policy 4.2).`;
    return `Listed on a regulated market: simplified due diligence, no beneficial owners to verify (policy 4.2).`;
  }
  if (ch?.type && ICVC_TYPES.has(ch.type)) return "An open-ended investment company authorised by the FCA: simplified due diligence (policy 4.1).";
  const name = String(input.partyName || ch?.name || "");
  if (!ch && PUBLIC_BODY.test(name)) return "A UK public body, by its name: simplified due diligence once that is confirmed (policy 4.3).";
  return null;
}

// ── Super-prime sales (risk assessment: transactions, high value) ───────────

// £5 million or more in London and the South East counties the risk
// assessment names (Berkshire, Buckinghamshire, East Sussex, Hampshire, the
// Isle of Wight, Kent, Oxfordshire, Surrey, West Sussex); more than £1
// million anywhere else. Read from the postcode: areas that cross a boundary
// are read district by district.
const LONDON_SOUTH_EAST_AREAS = new Set([
  "E", "EC", "N", "NW", "SE", "SW", "W", "WC", "BR", "CR", "DA", "HA", "KT", "SM", "TW", "UB",
  "BN", "CT", "GU", "ME", "OX", "PO", "RG", "RH", "SL", "SO", "TN",
]);
const SPLIT_DISTRICTS: Record<string, (n: number) => boolean> = {
  EN: n => n >= 1 && n <= 5,                 // Enfield and Barnet (London); EN6 to EN11 Hertfordshire and Essex
  IG: n => (n >= 1 && n <= 6) || n === 8 || n === 11, // Redbridge and Barking (London); IG7, IG9, IG10 Essex
  RM: n => n >= 1 && n <= 14,                // Havering, Barking and Dagenham (London); RM15 to RM20 Essex and Thurrock
  HP: n => n >= 5 && n !== 23,               // Buckinghamshire; HP1 to HP4 and HP23 Hertfordshire
  MK: n => n <= 19 || n === 46,              // Milton Keynes (Buckinghamshire); MK40 to MK45 Bedfordshire
  SP: n => n === 6 || n === 10 || n === 11,  // Fordingbridge and Andover (Hampshire); the rest Wiltshire and Dorset
};
export const SUPER_PRIME_SOUTH_EAST = 5_000_000;
export const SUPER_PRIME_ELSEWHERE = 1_000_000;

export function inLondonOrSouthEast(postcode: string | null | undefined): boolean | null {
  const m = /^([A-Z]{1,2})(\d{1,2})[A-Z]?\s*\d[A-Z]{2}$/.exec(String(postcode || "").toUpperCase().replace(/\s+/g, " ").trim())
    || /^([A-Z]{1,2})(\d{1,2})[A-Z]?$/.exec(String(postcode || "").toUpperCase().trim());
  if (!m) return null;
  const area = m[1], district = Number(m[2]);
  if (SPLIT_DISTRICTS[area]) return SPLIT_DISTRICTS[area](district);
  return LONDON_SOUTH_EAST_AREAS.has(area);
}

/** A sale or purchase over HMRC's super-prime value, as a flag on the deal. */
export function superPrimeFlag(deal: { dealType?: string | null; team?: string[] | string | null; pricing?: number | string | null; postcode?: string | null }): KycRedFlag | null {
  if (!isInvestmentDeal(deal.dealType ?? null, deal.team ?? null)) return null;
  const price = Number(deal.pricing);
  if (!Number.isFinite(price) || price <= 0) return null;
  const southEast = inLondonOrSouthEast(deal.postcode);
  const over = southEast ? price >= SUPER_PRIME_SOUTH_EAST : price > SUPER_PRIME_ELSEWHERE;
  if (!over) return null;
  const where = southEast === true ? "London or the South East (£5m or more)" : southEast === false ? "outside London and the South East (over £1m)" : "where the property's region is not known, so the £1m line is used";
  const money = price >= 1_000_000 ? `£${(price / 1_000_000).toLocaleString("en-GB", { maximumFractionDigits: 2 })}m` : `£${Math.round(price).toLocaleString("en-GB")}`;
  return {
    kind: "super_prime", factor: true,
    label: `Super-prime sale: ${money}, ${where}`,
    detail: "Risk assessment: a transaction above HMRC's super-prime value is high risk, with enhanced due diligence on the parties' background, the intended use and the business case.",
    source: POLICY_SOURCE, at: null,
    key: "deal:super_prime", evidence: [`price:${Math.round(price)}`, `postcode:${keyPart(deal.postcode || "unknown")}`],
    facts: [{ label: "Price", value: money }, { label: "Property postcode", value: deal.postcode || "not recorded" }],
  };
}

// ── Joint agents: what HMRC asks (Woody, 22 November 2026) ──────────────────
//
// "We have to do what HMRC say", then "Let's get the app to follow HMRC
// rules". HMRC's guidance, read on GOV.UK on 22 November 2026:
// - a sale (estate agency, AMLG2200 section 21, joint sole agency): "The EAB
//   who did not identify the buyer should request the CDD documentation from
//   the other EAB. If the CDD documentation is not provided by the other EAB,
//   the EAB should document in writing that it has been requested and not
//   provided." So the other side of a sale the joint agent found needs no
//   checks of BGP's own, once BGP has asked and recorded the answer;
// - a letting at £10,000 a month or more (AMLG2300 section 17): "LABs must
//   verify that all parties to the rental agreement are who they say they
//   are", with no joint agent exception (section 23 lists the only cases
//   needing no checks). So the tenant is checked by BGP, or BGP relies on the
//   joint agent's checks under a reliance agreement (MLR 2017 reg 39);
// - a letting under that: sanctions checks only (amlRegime).

export type JointAgentRule = "sale" | "letting" | "letting_under" | "advisory" | "other";

/** Which of HMRC's joint agent routes a deal is on. */
export function jointAgentRule(deal: { dealType?: string | null; team?: string[] | string | null; rentPa?: number | string | null }): JointAgentRule {
  const { regime } = amlRegime(deal);
  if (regime === "advisory") return "advisory";
  if (regime === "sanctions_only") return "letting_under";
  const type = String(deal.dealType || "").trim();
  if (isInvestmentDeal(type, deal.team ?? null)) return "sale";
  const letting = ALL_LETTING_TYPES.includes(type) || (TENANT_REP_TYPES as readonly string[]).includes(type) || /^(lease renewal|regear)$/i.test(type);
  return letting ? "letting" : "other";
}

// One line each (Woody, 22 November 2026: a status, not an explanation; the
// HMRC references are on the Rules page).
export const JOINT_AGENT_RULE_WORDS: Record<JointAgentRule, string> = {
  sale: "A sale: ask the joint agent for their checks and record what comes back.",
  letting: "A letting: ask the joint agent for the documents and check this party yourself.",
  letting_under: "A letting under £10,000 a month: sanctions checks only.",
  advisory: "Advisory work: no checks on the other side.",
  other: "Not a sale: ask the joint agent for the documents and check this party yourself.",
};

/** Why the joint agent reason cannot be used on this deal, in HMRC's terms, or null when it can. */
export function jointAgentNotRequiredRefusal(rule: JointAgentRule): string | null {
  if (rule === "letting") return "Not on a letting of £10,000 a month or more: every party is checked. Rely on the joint agent's checks under the reliance terms, or send the client checks.";
  if (rule === "other") return "Only a sale has the joint agent route. Check this party, or rely on the joint agent's checks under the reliance terms.";
  return null;
}

// ── Not required: the other side of a deal (policy G note; F.f) ─────────────

export const NOT_REQUIRED_REASONS = {
  joint_agent: "The joint agent found and dealt with this party",
  no_deal: "No transaction was done with this party",
} as const;
export type NotRequiredReason = keyof typeof NOT_REQUIRED_REASONS;
export const NOT_REQUIRED_COMMENT_MIN = 10;

// How BGP asked the joint agent for their checks, and what came back (HMRC:
// "document in writing that it has been requested and not provided").
export const JOINT_ASKED_HOW = { app: "through the app", email: "by email", phone: "by phone", letter: "by letter", meeting: "in a meeting" } as const;
export type JointAskedHow = keyof typeof JOINT_ASKED_HOW;
export const JOINT_OUTCOMES = { received: "they sent their checks", partly: "they sent part of their checks", not_provided: "they did not provide them" } as const;
export type JointOutcome = keyof typeof JOINT_OUTCOMES;
// missing: what did not come (on "partly"). note: the officer's words on what
// their files showed, or how they checked by hand (22 November 2026).
export interface JointAskRecord { askedOn: string; how: JointAskedHow; whom: string; outcome: JointOutcome; ref: string | null; missing?: string[] | null; note?: string | null }

/** "Asked Savills (Jane Smith) for their checks on 22 Nov 2026, through the app: they sent part of their checks (not sent: ...)". */
export function jointAskWords(a: JointAskRecord): string {
  const day = new Date(`${a.askedOn}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const missing = a.outcome === "partly" && a.missing?.length ? ` (not sent: ${a.missing.join("; ")})` : "";
  return `Asked ${a.whom} for their checks on ${day}, ${JOINT_ASKED_HOW[a.how]}: ${JOINT_OUTCOMES[a.outcome]}${missing}`;
}

/**
 * A joint agent request made in the app, as the Not required form can name
 * it. how: "email" for files the joint agent emailed to someone at BGP and BGP
 * added (sentAt is then the day they were added). files: how many came back.
 */
export interface JointRequestForRecord {
  ref: string; sentAt: string | null; whom: string; how?: "app" | "email"; files?: number;
  // What their files do not cover, and what they show to look at, in BGP's words (shared/joint-agent-checks.ts).
  missing?: string[]; flags?: string[];
}

export function notRequiredInput(
  body: unknown,
  ctx: { rule?: JointAgentRule; today?: Date; requests?: JointRequestForRecord[] } = {},
): { reason: NotRequiredReason; comment: string; asked: JointAskRecord | null } | { problem: string } {
  const b = (body || {}) as Record<string, unknown>;
  const reason = String(b.reason || "");
  if (!Object.prototype.hasOwnProperty.call(NOT_REQUIRED_REASONS, reason)) return { problem: "Choose why no checks are needed on this party." };
  const comment = String(b.comment ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (comment.length < NOT_REQUIRED_COMMENT_MIN) return { problem: `Say what happened (at least ${NOT_REQUIRED_COMMENT_MIN} characters): it is kept on the transaction.` };
  if (reason !== "joint_agent") return { reason: reason as NotRequiredReason, comment, asked: null };
  const rule = ctx.rule || "other";
  const refused = jointAgentNotRequiredRefusal(rule);
  if (refused) return { problem: refused };
  // A letting under £10,000 a month or advisory work needs no record of asking.
  if (rule !== "sale") return { reason: "joint_agent", comment, asked: null };
  const outcome = String(b.outcome || "") as JointOutcome;
  if (!(outcome in JOINT_OUTCOMES)) return { problem: "Say what came back from the joint agent: their checks, part of them, or nothing." };
  const note = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  const listOf = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(/\s*[;\n]\s*/)).map(x => String(x).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 20);
  const typedMissing = listOf(b.missing);
  const ref = String(b.jointRef || "").trim().toUpperCase();
  if (ref) {
    const req = (ctx.requests || []).find(r => r.ref === ref);
    if (!req) return { problem: "That request to the joint agent is not on this party." };
    if (!req.sentAt) return { problem: "That request to the joint agent was not sent: send it, or record how you asked." };
    if (outcome !== "not_provided" && req.files === 0) return { problem: "Nothing has come back on that request yet: wait for their checks, or record that they did not provide them." };
    const notes: string[] = [];
    // Their files show something to look at: say what you did about it first.
    if (outcome !== "not_provided" && req.flags?.length) {
      const flagNote = note(b.flagNote);
      if (flagNote.length < NOT_REQUIRED_COMMENT_MIN) return { problem: `Their files show something to look at: ${req.flags.join("; ")}. Say what you did about it.` };
      notes.push(`On what their files showed: ${flagNote}`);
    }
    let missing: string[] | null = null;
    if (outcome === "partly") {
      missing = typedMissing.length ? typedMissing : req.missing || [];
      if (!missing.length) return { problem: "Say what they did not send." };
    }
    if (outcome === "received" && req.missing?.length) {
      const byHand = note(b.checkedByHand);
      if (byHand.length < NOT_REQUIRED_COMMENT_MIN) return { problem: `Their files do not cover: ${req.missing.join("; ")}. Choose "they sent part of their checks", or say how you checked these by hand.` };
      notes.push(`Checked by hand: ${byHand}`);
    }
    return { reason: "joint_agent", comment, asked: { askedOn: req.sentAt.slice(0, 10), how: req.how || "app", whom: req.whom, outcome, ref, missing, note: notes.join(" ") || null } };
  }
  const askedOn = String(b.askedOn || "").trim();
  const when = /^\d{4}-\d{2}-\d{2}$/.test(askedOn) ? new Date(`${askedOn}T12:00:00Z`) : null;
  if (!when || Number.isNaN(when.getTime())) return { problem: "Give the date you asked the joint agent for their checks." };
  if (when.getTime() > (ctx.today || new Date()).getTime() + 86400000) return { problem: "The date you asked cannot be in the future." };
  const how = String(b.askedHow || "") as JointAskedHow;
  if (!(how in JOINT_ASKED_HOW) || how === "app") return { problem: "Say how you asked: by email, phone, letter or in a meeting." };
  const whom = String(b.askedWhom || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (whom.length < 2) return { problem: "Say who you asked at the joint agent." };
  if (outcome === "partly" && !typedMissing.length) return { problem: "Say what they did not send." };
  return { reason: "joint_agent", comment, asked: { askedOn, how, whom, outcome, ref: null, missing: outcome === "partly" ? typedMissing : null, note: null } };
}

export interface PartyNotRequired {
  id: number; reason: NotRequiredReason; reasonWords: string; comment: string; by: string | null; at: string | null;
  // On a sale: when, how and whom BGP asked for the joint agent's checks, and what came back.
  asked?: JointAskRecord | null;
}

/**
 * Whether a Not required mark still counts under HMRC's rules: the joint
 * agent reason holds on a sale only with the record of asking, and never on
 * a letting at £10,000 a month or more. Null when it counts; else why not.
 */
export function notRequiredLapse(mark: { reason: NotRequiredReason; asked?: JointAskRecord | null }, rule: JointAgentRule): string | null {
  if (mark.reason !== "joint_agent") return null;
  const refused = jointAgentNotRequiredRefusal(rule);
  if (refused) return refused;
  if (rule === "sale" && !mark.asked) return "No record of asking the joint agent for their checks. Take this off and mark it again with the record.";
  return null;
}

// ── Heads of terms and marketing (policy 3.8) ───────────────────────────────

// "Heads of terms and marketing collateral will include references to the
// obligations for all parties to provide appropriate levels of information to
// complete due diligence and source of funds checks."
export const AML_HOTS_CLAUSE = "Bruce Gillingham Pollard is required by the Money Laundering, Terrorist Financing and Transfer of Funds (Information on the Payer) Regulations 2017 and the Sanctions and Anti-Money Laundering Act 2018 to complete customer due diligence and sanctions checks on every party before the transaction completes. Each party will promptly provide the identification, ownership and source of funds information requested.";
export const AML_MARKETING_NOTICE = "Anti-money laundering. Under the Money Laundering Regulations 2017 and the Sanctions and Anti-Money Laundering Act 2018, Bruce Gillingham Pollard checks every party to a transaction. The successful purchaser or tenant will be asked for identification, details of who owns or controls it and where its funds come from before the deal completes.";

// ── Sign-off: who may (Woody's answer) ──────────────────────────────────────

/** A deal's agent: their login is on the deal, or their name is. */
export function isDealAgent(user: { id: string; name?: string | null }, deal: { internal_agent_ids?: unknown; internal_agent?: unknown }): boolean {
  const ids = Array.isArray(deal.internal_agent_ids) ? deal.internal_agent_ids.map(String) : [];
  if (ids.includes(String(user.id))) return true;
  const name = lower(user.name);
  const names = Array.isArray(deal.internal_agent) ? deal.internal_agent.map(lower) : [];
  return !!name && names.includes(name);
}
