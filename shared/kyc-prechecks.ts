// BGP's own checks on a deal party before anyone is asked anything. Woody,
// 17 November 2026: "can you make sure you use all the companies house APIS
// to get the recent accounts downloaded for any check first before asking?",
// "and also access to plcs? how do we deal with that?", "the pep is that
// siorted?", "and the poloticaly media riskes etc ?", "we need to do
// everyhting we can before we ask questions on someone". Asked, he chose a
// web search with sources for public roles and adverse media now
// (ComplyAdvantage once it is unblocked and has fresh keys), and to ask the
// client only what is left.
//
// Pure: what a result means, what is still to ask, the red flags, the lines
// KYC4U's note carries and the lines the deal's AML card shows.
// server/kyc-prechecks.ts gathers the facts. Nothing here decides anything:
// the deal's agents, the Nominated Officer and the Deputy do, with KYC4U
// (BGP's outsourced KYC provider) for enhanced due diligence.

import { defaultKycDocs, type KycDocKey, type KycPartyKind } from "./kyc-request";
import type { PrecheckAbroad, PrecheckGleif } from "./foreign-owners";
import { gleifPartyWords, gleifTraceWords, gleifUkRegister, parentLineWords } from "./foreign-owner-words";
import { charityConcerns, charityLines, charityRegisterUrl, type PrecheckCharity } from "./charity-register";
import type { KycFlagFact, KycRedFlag } from "./kyc-red-flags";
import { companyTypeWords } from "./company-facts";

// A part of a red flag's key: the same words however they are written.
export const flagKeyPart = (value: unknown): string => String(value ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);

export const KYC_PRECHECK_VERSION = 1;
// A pre-check this recent is used as it is; an older one runs again when
// the deal's AML card is opened.
export const KYC_PRECHECK_FRESH_DAYS = 30;
// The most people searched on the web in one run (the company is extra).
export const KYC_PRECHECK_MAX_WEB_PEOPLE = 10;

// ── Companies House: a listed company ───────────────────────────────────────
//
// The exemptions resource (GET /company/{n}/exemptions) says a company need
// not keep a PSC register because its voting shares trade on a market.
// MLR 2017 reg 28(5): a company "listed on a regulated market" has no
// beneficial owners to identify, though the company itself is still
// identified and verified (HMRC, AMLG11400 14.7). A UK or EU regulated
// market counts as it stands; a market elsewhere counts when its disclosure
// rules are equivalent, which KYC4U confirms. AIM is not a regulated market:
// an AIM company keeps a PSC register and is asked like any other.

export type ListingMarket = "uk_regulated" | "dtr5" | "eu_regulated" | "other_regulated" | "listed_market";

const EXEMPTION_MARKETS: Array<[string, ListingMarket]> = [
  ["psc_exempt_as_trading_on_uk_regulated_market", "uk_regulated"],
  ["disclosure_transparency_rules_chapter_five_applies", "dtr5"],
  ["psc_exempt_as_trading_on_eu_regulated_market", "eu_regulated"],
  ["psc_exempt_as_trading_on_regulated_market", "other_regulated"],
  ["psc_exempt_as_shares_admitted_on_market", "listed_market"],
];

export const LISTING_WORDS: Record<ListingMarket, string> = {
  uk_regulated: "listed on a UK regulated market",
  dtr5: "listed on a regulated market (the FCA's Disclosure and Transparency Rules apply)",
  eu_regulated: "listed on an EU regulated market",
  other_regulated: "listed on a regulated market outside the UK",
  listed_market: "listed on a market outside the UK named in the PSC Regulations",
};

// The markets that need no one to weigh them.
export const listingSettled = (market: ListingMarket): boolean => market === "uk_regulated" || market === "dtr5" || market === "eu_regulated";

export interface PrecheckListing {
  market: ListingMarket;
  since: string | null;
  company: string;
  companyNumber: string;
  // Not the party itself: the company at the top of its ownership chain,
  // reached through one corporate owner at every level.
  viaParent: boolean;
}

export function listingFromExemptions(data: unknown, today = new Date()): { market: ListingMarket; since: string | null } | null {
  const exemptions = (data as any)?.exemptions;
  if (!exemptions || typeof exemptions !== "object") return null;
  const day = today.toISOString().slice(0, 10);
  for (const [key, market] of EXEMPTION_MARKETS) {
    const items: any[] = Array.isArray(exemptions[key]?.items) ? exemptions[key].items : [];
    const current = items.filter(item => !item?.exempt_to || String(item.exempt_to) >= day);
    if (current.length) {
      const since = current.map(item => String(item?.exempt_from || "")).filter(Boolean).sort()[0] || null;
      return { market, since };
    }
  }
  return null;
}

// ── Companies House: owners and statements ─────────────────────────────────

export type RegisterOwnerKind = "individual" | "company" | "legal_person" | "protected" | "other";

export interface RegisterOwner {
  name: string;
  kind: RegisterOwnerKind;
  controls: string[];
  notifiedOn: string | null;
  country?: string | null;
  registrationNumber?: string | null;
  nationality?: string | null;
  // An individual owner's country of residence, as the register gives it
  // (read since 19 November 2026: the AML policy's geography factors).
  residence?: string | null;
  dob?: { month?: number | null; year?: number | null } | null;
  // A registered beneficial owner of an overseas entity that the entity
  // declared sanctioned on its latest filing (the Register of Overseas
  // Entities' is_sanctioned, read since 19 November 2026).
  sanctioned?: boolean | null;
  // An individual owner's identity verification at Companies House (read since 21 November 2026).
  idv?: PrecheckIdv | null;
}

export function ownerKind(chKind: unknown): RegisterOwnerKind {
  const k = String(chKind || "");
  if (/^individual/.test(k)) return "individual";
  if (/^corporate-entity/.test(k)) return "company";
  if (/^legal-person/.test(k)) return "legal_person";
  if (/^super-secure/.test(k)) return "protected";
  return "other";
}

const BAND_WORDS: Record<string, string> = {
  "25-to-50-percent": "more than 25% and up to 50%",
  "50-to-75-percent": "more than 50% and up to 75%",
  "75-to-100-percent": "more than 75%",
};

// Companies House's natures of control, in words.
export function controlWords(control: string): string {
  const c = String(control || "");
  const through = /-as-trust/.test(c) ? " (as a trustee)" : /-as-firm/.test(c) ? " (through a firm)" : "";
  const band = Object.keys(BAND_WORDS).find(b => c.includes(b));
  if (band && /^ownership-of-shares/.test(c)) return `${BAND_WORDS[band]} of the shares${through}`;
  if (band && /^voting-rights/.test(c)) return `${BAND_WORDS[band]} of the votes${through}`;
  if (band && /^right-to-share-surplus-assets/.test(c)) return `${BAND_WORDS[band]} of the surplus assets${through}`;
  if (/^right-to-appoint-and-remove-directors/.test(c)) return `can appoint or remove most of the directors${through}`;
  if (/^right-to-appoint-and-remove-members/.test(c)) return `can appoint or remove most of the members${through}`;
  if (/^right-to-appoint-and-remove-person/.test(c)) return `can appoint or remove the person in charge${through}`;
  if (/^significant-influence-or-control/.test(c)) return `significant influence or control${through}`;
  return c.replace(/-/g, " ").trim();
}

export const ownerControlLine = (owner: Pick<RegisterOwner, "controls">): string =>
  [...new Set((owner.controls || []).map(controlWords).filter(Boolean))].join("; ");

// PSC statements (GET /company/{n}/persons-with-significant-control-statements).
// Companies House spells "signficant" without the second i in these values.
const STATEMENT_WORDS: Record<string, string> = {
  "no-individual-or-entity-with-signficant-control": "The company says no one has significant control over it",
  "steps-to-find-psc-not-yet-completed": "The company has not finished finding out who has significant control over it",
  "psc-exists-but-not-identified": "The company knows someone has significant control but has not identified them",
  "psc-details-not-confirmed": "The company has identified someone with significant control but not confirmed their details",
  "psc-contacted-but-no-response": "The company asked someone with significant control for their details and had no reply",
  "restrictions-notice-issued-to-psc": "The company has issued a restrictions notice to someone with significant control",
  "psc-has-failed-to-confirm-changed-details": "Someone with significant control has not confirmed their changed details",
};
const STATEMENT_CONCERNS = new Set([
  "steps-to-find-psc-not-yet-completed", "psc-exists-but-not-identified", "psc-details-not-confirmed",
  "psc-contacted-but-no-response", "restrictions-notice-issued-to-psc", "psc-has-failed-to-confirm-changed-details",
]);
const statementKey = (statement: string) => String(statement || "").replace(/-partnership$/, "");
export const statementWords = (statement: string): string =>
  STATEMENT_WORDS[statementKey(statement)] || String(statement || "").replace(/-/g, " ").replace(/\bpsc\b/g, "person with significant control").trim();
export const statementIsConcern = (statement: string): boolean => STATEMENT_CONCERNS.has(statementKey(statement));

// ── Names ───────────────────────────────────────────────────────────────────

const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "sir", "dame", "lord", "lady", "prof", "professor", "rev", "hon", "the"]);
const COMPANY_WORDS = new Set(["ltd", "limited", "llc", "llp", "lp", "plc", "inc", "incorporated", "corp", "corporation", "gmbh", "sa", "ag", "bv", "nv", "pty", "co", "company", "and", "of", "the", "group", "holdings"]);

export function nameTokens(name: string, company = false): string[] {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !TITLES.has(t) && !(company && COMPANY_WORDS.has(t)));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = keep;
    }
  }
  return prev[b.length];
}

export const sameToken = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && levenshtein(a, b) <= 1);
const covers = (outer: string[], inner: string[]) => inner.every(t => outer.some(o => sameToken(o, t)));

const DISPLAY_TITLE = /^(mr|mrs|ms|miss|mx|dr|sir|dame|lord|lady|prof|professor|rev|revd)\.?\s+/i;

/** A name as people write it: "BRUCE, David" is "David Bruce", "Mr Woody Bruce" is "Woody Bruce", "jack barrat" is "Jack Barrat". */
export function personDisplayName(raw: string): string {
  let name = String(raw || "").replace(/\s+/g, " ").trim();
  const comma = /^([^,]+),\s*(.+)$/.exec(name);
  if (comma) name = `${comma[2]} ${comma[1]}`;
  name = name.replace(DISPLAY_TITLE, "");
  return name.split(" ").map(word => word === word.toUpperCase() || word === word.toLowerCase()
    ? word.toLowerCase().replace(/(^|[-'’])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    : word).join(" ");
}

// One name holds every word of the other (two words at least), in any
// order: "SMITH, John David" and "John Smith".
export function personNamesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a), tb = nameTokens(b);
  return (ta.length >= 2 && covers(tb, ta)) || (tb.length >= 2 && covers(ta, tb));
}

// ── Who did the identity check (Woody, 19 November 2026) ───────────────────
// "this is email about jack barrat but its actually after woody bruce did the
// check so its got confused jack hasnt done his yet": the agents are copied
// on the request, Woody opened his copy of Jack's link and passed Veriff
// himself, and the app reported it as Jack's. Veriff reads the name off the
// document (verification.person); the app sets it against the person the
// request was for.

/** The name Veriff read off the document, or null. */
export function verifiedPersonName(verdictPerson: unknown): string | null {
  const vp = verdictPerson as Record<string, unknown> | null;
  if (!vp || typeof vp !== "object") return null;
  const parts = [vp.firstName, vp.lastName].filter((x): x is string => typeof x === "string" && !!x.trim());
  const name = (parts.length ? parts.join(" ") : typeof vp.fullName === "string" ? vp.fullName : "").replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 160) : null;
}

/** Whether the person Veriff checked is the one the request was for: null when either name is missing. */
export function idCheckIsThePerson(requested: string | null | undefined, verified: string | null | undefined): boolean | null {
  if (!requested || !verified) return null;
  const a = nameTokens(requested), b = nameTokens(verified);
  if (!a.length || !b.length) return null;
  if (personNamesMatch(requested, verified)) return true;
  // A first name alone on the request: the document's name holds it.
  return a.length === 1 && b.some(t => sameToken(t, a[0]));
}

export function companyNamesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a, true), tb = nameTokens(b, true);
  if (!ta.length || !tb.length) return false;
  if (ta.length === tb.length && covers(ta, tb) && covers(tb, ta)) return true;
  return (ta.length >= 2 && covers(tb, ta)) || (tb.length >= 2 && covers(ta, tb));
}

// A contact is one of the party's directors (or LLP members) on the register.
export const isRegisterDirector = (contactName: string | null | undefined, directors: string[]): boolean =>
  !!contactName && directors.some(d => personNamesMatch(contactName, d));

// ── Sanctions ───────────────────────────────────────────────────────────────
//
// The lists (the UK Sanctions List, the US OFAC list and, since 19 November
// 2026, the EU consolidated list) are matched on
// names, so a common name matches someone else. A listing counts as a
// possible match when one name holds every word of the other (two words at
// least), and is set aside only when both dates of birth are known and the
// years are more than one apart. Everything else is "no match".

export type SanctionsListCode = "UK" | "US" | "EU";
export const SANCTIONS_LIST_NAME: Record<SanctionsListCode, string> = { UK: "UK Sanctions List", US: "US OFAC list", EU: "EU consolidated list" };
/** A list's name in words, whatever code it was stored with. */
export const sanctionsListName = (code: unknown): string => SANCTIONS_LIST_NAME[(code as SanctionsListCode)] || SANCTIONS_LIST_NAME.UK;
/** The code for a list as the screening module names it. */
export const sanctionsListCode = (source: unknown): SanctionsListCode => (source === "US-OFAC" ? "US" : source === "EU-FSF" ? "EU" : "UK");

export interface ListEntry {
  name: string;
  source: SanctionsListCode;
  regime: string;
  designationType: string;
  dob: string;
  nationality: string;
}

export interface SanctionsMatch extends ListEntry { why: string }

export interface SanctionsLine {
  name: string;
  role: string;
  outcome: "clear" | "possible" | "discounted";
  matches: SanctionsMatch[];
}

const listedAsPerson = (e: ListEntry) => /individual/i.test(e.designationType);
const listedAsThing = (e: ListEntry) => /ship|vessel|aircraft/i.test(e.designationType);

export function sanctionsLine(subject: { name: string; role: string; person: boolean; dobYear?: number | null }, candidates: ListEntry[]): SanctionsLine {
  const possible: SanctionsMatch[] = [];
  const discounted: SanctionsMatch[] = [];
  for (const entry of candidates) {
    if (listedAsThing(entry)) continue;
    if (subject.person ? !listedAsPerson(entry) && entry.designationType.trim() !== "" : listedAsPerson(entry)) continue;
    const matched = subject.person ? personNamesMatch(subject.name, entry.name) : companyNamesMatch(subject.name, entry.name);
    if (!matched) continue;
    const years = (String(entry.dob || "").match(/\b(19|20)\d{2}\b/g) || []).map(Number);
    if (subject.person && subject.dobYear && years.length && !years.some(y => Math.abs(y - subject.dobYear!) <= 1)) {
      discounted.push({ ...entry, why: `The name matches, but the list gives a date of birth in ${years.join(" or ")} and Companies House gives ${subject.dobYear}.` });
      continue;
    }
    const born = subject.person && subject.dobYear && years.length ? " The year of birth matches too." : subject.person && !years.length ? " The list gives no date of birth to compare." : "";
    possible.push({ ...entry, why: `The name matches the listing.${born}` });
  }
  if (possible.length) return { name: subject.name, role: subject.role, outcome: "possible", matches: possible.slice(0, 3) };
  if (discounted.length) return { name: subject.name, role: subject.role, outcome: "discounted", matches: discounted.slice(0, 3) };
  return { name: subject.name, role: subject.role, outcome: "clear", matches: [] };
}

// ── The web search: public roles and adverse media ─────────────────────────

export type WebStatus = "none_found" | "possible" | "found";

export interface WebFinding {
  kind: "public_role" | "adverse_media";
  summary: string;
  url: string;
  source: string;
  date: string | null;
  category: string | null;
  // The source may be about someone else of the same name.
  unsureIdentity: boolean;
}

export interface WebSearchLine {
  name: string;
  role: string;
  // A person, not a company (lines before 19 November 2026 leave it out).
  person?: boolean;
  ran: boolean;
  error?: string | null;
  publicRole: WebStatus;
  adverseMedia: WebStatus;
  findings: WebFinding[];
  // Things the search said with no source that could be checked: never a
  // finding, only counted.
  unsourced: number;
}

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
};
const clip = (value: unknown, max: number): string => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// What the search said, kept only where it gave a source that is among the
// pages it actually read (its citations). A status with no source left
// behind it reads as nothing found.
// A "finding" that only says nothing was found (Woody, 21 November 2026, run
// against KYC4U's packs: on Brasserie Bordelaise the search returned "The
// search found no source establishing that the company is government/state-
// owned or controlled, or that its director is a politically exposed person"
// as a finding, and the app raised it as a red flag and made the party
// enhanced). Every sentence must say nothing was found, or only restate the
// register, for a finding to be dropped: anything else in it keeps it, so a
// real finding is never lost.
const NOTHING_FOUND = /\b(found|finds|identified|located)\s+no\b|\bno\s+(source|sources|evidence|record|records|indication|indications|information|mention|mentions|report|reports|result|results|link|links|connection|suggestion|credible)\b|\b(does|did|do)\s+not\s+(establish|show|indicate|suggest|appear|identify|find|reveal|confirm)\b|\bnot\s+(identified|found|listed|named|known)\s+(as|to\s+be)\b|\bthere\s+(is|was|are|were)\s+no\b|\bnothing\s+(was\s+)?(found|identified|suggest|indicat)|\bnone\s+(was\s+|were\s+)?(found|identified)\b|\b(could|can)\s*n[o']t\s+(find|identify|establish|confirm)\b|\bunable\s+to\s+(find|identify|establish|confirm|verify)\b|\bis\s+not\s+(a\s+)?(politically\s+exposed|pep\b|state[-\s]owned|government[-\s]owned)/i;
const REGISTER_ONLY = /\b(companies\s+house|the\s+register|public\s+register|registry)\b.*\b(lists?|shows?|names?|records?)\b|\b(lists?|shows?|names?|records?)\b.*\b(as\s+(the\s+)?(company'?s\s+)?(active\s+)?(sole\s+)?(director|officer|secretary|member|person\s+with\s+significant\s+control|shareholder))\b|\b(available|public)\s+records?\s+(lists?|shows?|names?)\b|\bwas\s+incorporated\s+(on|in)\b/i;
const BUT_THEN = /\b(but|however|although|though|yet|whereas)\b(.*)$/i;
export function webFindingSaysNothing(summary: string | null | undefined): boolean {
  const sentences = String(summary || "").split(/(?<=[.!?;])\s+/).map(t => t.trim()).filter(t => t.length > 2);
  if (!sentences.length) return false;
  let negative = false;
  for (const t of sentences) {
    const contrast = BUT_THEN.exec(t);
    // "No evidence of sanctions, but the director was convicted of fraud" says something.
    if (NOTHING_FOUND.test(t) && !(contrast && contrast[2].trim() && !NOTHING_FOUND.test(contrast[2]) && !REGISTER_ONLY.test(contrast[2]))) { negative = true; continue; }
    if (REGISTER_ONLY.test(t) && !/\b(convict|charg|fin(ed|e\s+of)|sentenc|ban(ned)?\b|disqualif|sanction|fraud|brib|corrupt|launder|minister|parliament|ambassador|judge|state[-\s]owned|government[-\s]owned|politically\s+exposed)/i.test(t)) continue;
    return false;
  }
  return negative;
}

/** The web search's findings for one line, less any that only says nothing was found (read so, as stored checks are). */
export const webFindingsOf = (line: Pick<WebSearchLine, "findings">): WebFinding[] => (line.findings || []).filter(f => !webFindingSaysNothing(f.summary));

export function checkWebAnswer(raw: unknown, citations: Array<{ url: string }>): Pick<WebSearchLine, "publicRole" | "adverseMedia" | "findings" | "unsourced"> {
  const cited = new Set(citations.map(c => hostOf(c?.url || "")).filter((h): h is string => !!h));
  const findings: WebFinding[] = [];
  let unsourced = 0;
  const read = (block: any, kind: WebFinding["kind"]): WebStatus => {
    const said: WebStatus = block?.status === "found" ? "found" : block?.status === "possible" ? "possible" : "none_found";
    const items: any[] = Array.isArray(block?.findings) ? block.findings.slice(0, 8) : [];
    let kept = 0;
    for (const item of items) {
      const url = clip(item?.url, 500);
      const host = hostOf(url);
      const summary = clip(item?.summary, 300);
      if (!summary || webFindingSaysNothing(summary)) continue;
      if (!host || !cited.has(host)) { unsourced++; continue; }
      findings.push({
        kind, summary, url, source: clip(item?.source, 80) || host,
        date: clip(item?.date, 20) || null, category: clip(item?.category, 40) || null,
        unsureIdentity: item?.sameIdentity === "unsure",
      });
      kept++;
    }
    if (!kept) {
      if (said !== "none_found" && !items.length) unsourced++;
      return "none_found";
    }
    return said === "none_found" ? "possible" : said;
  };
  const publicRole = read((raw as any)?.publicRole, "public_role");
  const adverseMedia = read((raw as any)?.adverseMedia, "adverse_media");
  return { publicRole, adverseMedia, findings, unsourced };
}

// ── The stored result ───────────────────────────────────────────────────────

export interface PrecheckDocument {
  kind: "accounts" | "confirmation_statement" | "incorporation";
  title: string;
  filedOn: string | null;
  madeUpTo: string | null;
  kycDocumentId: string | null;
  error: string | null;
}

export interface PrecheckOfficer {
  name: string;
  role: string;
  appointedOn: string | null;
  dob: { month?: number | null; year?: number | null } | null;
  nationality: string | null;
  // Companies House identity verification (read since 21 November 2026).
  idv?: PrecheckIdv | null;
}

// ── Identity verification at Companies House ─────────────────────────────────
//
// Since 18 November 2025 every director and person with significant control
// must verify their identity with Companies House (Economic Crime and
// Corporate Transparency Act 2023). The free API's officer and PSC lists carry
// identity_verification_details: identity_verified_on (filled only when an
// authorised corporate service provider did the check), and the dates the
// verification statement was supplied (appointment_verification_start_on),
// removed (…_end_on) and is due by (…_statement_due_on). A supplied statement
// that was not removed is read as verified (Companies House developer forum,
// January 2026: most verified appointments show no identity_verified_on).
// It is information for BGP's file, never BGP's own identity check.
export interface PrecheckIdv { verifiedOn: string | null; statementOn: string | null; dueOn: string | null; endedOn: string | null }
export type IdvState = "verified" | "due" | "overdue" | "not_shown";

/** The register's identity verification details, as the API gives them; null when it gives none. */
export function idvOf(details: unknown): PrecheckIdv | null {
  const d: any = details && typeof details === "object" ? details : null;
  if (!d) return null;
  // Companies House writes 9999-12-31 for a date not set (seen 21 November 2026: "removed on 31 Dec 9999").
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && v.slice(0, 4) < "9000" ? v.slice(0, 10) : null);
  const out = {
    verifiedOn: day(d.identity_verified_on),
    statementOn: day(d.appointment_verification_start_on),
    dueOn: day(d.appointment_verification_statement_due_on),
    endedOn: day(d.appointment_verification_end_on),
  };
  return out.verifiedOn || out.statementOn || out.dueOn || out.endedOn ? out : null;
}

const idvDay = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
};

/** Where one person's identity verification at Companies House stands, in words. */
export function idvState(idv: PrecheckIdv | null | undefined, today: Date = new Date()): { state: IdvState; words: string } {
  if (!idv) return { state: "not_shown", words: "no identity verification shown by Companies House" };
  // A check stored before the open-ended date was read as none keeps 9999-12-31: it is no date.
  if (idv.endedOn && idv.endedOn.slice(0, 4) >= "9000") idv = { ...idv, endedOn: null };
  if (idv.verifiedOn) return { state: "verified", words: `identity verified with Companies House on ${idvDay(idv.verifiedOn)}` };
  if (idv.statementOn && !idv.endedOn) return { state: "verified", words: `identity verified with Companies House (statement given ${idvDay(idv.statementOn)})` };
  if (idv.dueOn) {
    const overdue = idv.dueOn < today.toISOString().slice(0, 10);
    return overdue
      ? { state: "overdue", words: `identity verification overdue at Companies House (was due ${idvDay(idv.dueOn)})` }
      : { state: "due", words: `identity verification due at Companies House by ${idvDay(idv.dueOn)}` };
  }
  return { state: "not_shown", words: idv.endedOn ? `identity verification statement removed at Companies House on ${idvDay(idv.endedOn)}` : "no identity verification shown by Companies House" };
}

/** The directors and individual owners, each with their identity verification at Companies House. */
export function precheckIdentity(ch: KycPrecheckResult["companiesHouse"] | null | undefined, today: Date = new Date()): Array<{ name: string; role: string; state: IdvState; words: string }> {
  if (!ch) return [];
  const out: Array<{ name: string; role: string; state: IdvState; words: string }> = [];
  for (const o of ch.officers.filter(x => /director|member/i.test(x.role))) {
    if (o.idv === undefined) continue; // a check from before this was read
    out.push({ name: o.name, role: o.role.replace(/-/g, " "), ...idvState(o.idv, today) });
  }
  for (const o of ch.owners.filter(x => x.kind === "individual")) {
    if (o.idv === undefined) continue;
    const same = out.find(x => personNamesMatch(x.name, o.name));
    if (same) { if (same.state === "not_shown" && o.idv) Object.assign(same, idvState(o.idv, today)); continue; }
    out.push({ name: o.name, role: "owner", ...idvState(o.idv, today) });
  }
  return out;
}

// ── Is it trading? (KYC4U's "Is a trading company?" and "Non trading risk") ──
//
// Woody, 21 November 2026 ("and 8"): a dormant, non-trading or newly formed
// company is a warning on the file, read from the register: accounts filed as
// dormant or business code 99999 (dormant company), business code 74990
// (non-trading company), or incorporated in the last year with no accounts
// filed yet. A warning to weigh, not a red flag: BGP's AML policy does not
// list it among the higher-risk factors.
export function tradingState(ch: KycPrecheckResult["companiesHouse"] | null | undefined, today: Date = new Date()): { trading: boolean | null; kind: "dormant" | "non_trading" | "new" | null; words: string | null } {
  if (!ch) return { trading: null, kind: null, words: null };
  const sic = (ch.sicCodes || []).map(c => String(c).trim());
  if (/dormant/i.test(String(ch.lastAccountsType || ""))) return { trading: false, kind: "dormant", words: `Dormant: its latest accounts${ch.lastAccountsMadeUpTo ? ` (made up to ${ch.lastAccountsMadeUpTo})` : ""} were filed as dormant` };
  if (sic.includes("99999")) return { trading: false, kind: "dormant", words: "Dormant: its business code at Companies House is 99999, dormant company" };
  if (sic.includes("74990")) return { trading: false, kind: "non_trading", words: "Not trading: its business code at Companies House is 74990, non-trading company" };
  if (!ch.lastAccountsMadeUpTo && ch.incorporatedOn) {
    const inc = new Date(`${ch.incorporatedOn.slice(0, 10)}T12:00:00Z`);
    if (!Number.isNaN(inc.getTime()) && today.getTime() - inc.getTime() < 366 * 86400000) {
      return { trading: null, kind: "new", words: `Newly formed: incorporated on ${ch.incorporatedOn.slice(0, 10)}, no accounts filed yet` };
    }
  }
  return { trading: ch.lastAccountsMadeUpTo ? true : null, kind: null, words: null };
}

// A profile ComplyAdvantage matched, as its alert describes it (kept since
// 19 November 2026; earlier checks kept only the kinds).
export interface ProviderMatch {
  name: string;
  kind: string;
  source: string | null;
  score: number | null;
  profileId: string | null;
  media: Array<{ title: string; url: string | null; date: string | null }>;
  // The profile's date of birth agrees with the person's: the same year and
  // month when both give a month, else within a year (null when either is not
  // known). Since 19 November 2026.
  birthYearAgrees?: boolean | null;
  // ComplyAdvantage said it matched but its profiles could not be read.
  unread?: boolean;
}
export interface ProviderLine {
  name: string;
  status: "clear" | "possible" | "error";
  types: string[];
  detail: string | null;
  matches?: ProviderMatch[];
  // The customer record ComplyAdvantage made for the screen.
  customerId?: string | null;
  // Since 19 November 2026 (Woody: "red flags for random people with similar
  // names ... whats the fix?"): whether the line is a person, and whether they
  // were screened with a date of birth (from Companies House). Older checks
  // have neither and keep the rule they were made under.
  person?: boolean;
  dobKnown?: boolean;
}

// Who ComplyAdvantage and the web search screen for public roles and adverse
// media (Woody, 19 November 2026: "At that point need to work out who needs
// to be AML/KYC"). MLR 2017: a company's beneficial owners are the people who
// own or control more than 25% of it (reg 5), traced through the companies
// above it; they are identified and screened. A company listed on a regulated
// market has none to identify (reg 28(5)). Where no owner can be named, the
// people who manage the company stand in for them (reg 28(6)). Everyone else
// on the register (directors, the secretary) and the deal's contact are
// screened against the sanctions lists only.
export type ScreenBasis = "owners" | "managers" | "listed" | "individual" | "company" | "owners_abroad" | "trustees";
export interface PrecheckScreened {
  basis: ScreenBasis;
  // The people screened for public roles and adverse media.
  people: string[];
  // The people screened against the sanctions lists only.
  sanctionsOnly: string[];
}
export const SCREEN_BASIS_WORDS: Record<ScreenBasis, string> = {
  owners: "the company and the people who own or control it (its beneficial owners: found on the register and up the ownership chain, or recorded behind a company abroad that owns it)",
  managers: "the company and its directors, standing in for the owners because none could be named",
  listed: "the company only: a company listed on a regulated market has no beneficial owners to identify",
  individual: "the person, and anyone named alongside them",
  company: "the company only: no owner or director could be named from the register",
  owners_abroad: "the company, the company registered abroad that owns it, and its directors meanwhile: Companies House cannot show who owns that company, so the client is asked for the people behind it",
  trustees: "the charity and its trustees, who control it, as the Charity Commission's register names them",
};
// One person or company a run screens, as the server lists them: the roles
// they were found in ("the company", "owner", "owner of <company up the
// chain>", "director", "secretary", "the deal's contact", "the party"), joined
// with ", " when one person is found twice.
// abroad: a company registered outside the UK that owns the party (on the
// register or up the chain), screened as a company in full (20 November 2026).
// trustee: a trustee of the charity the party is, or acts for, from the
// Charity Commission's register (21 November 2026).
export interface ScreenCandidate { name: string; role: string; person: boolean; owner?: boolean; abroad?: boolean; trustee?: boolean }

const roles = (c: ScreenCandidate) => c.role.split(", ");
const isManager = (c: ScreenCandidate) => c.person && roles(c).some(r => /director|member/i.test(r) && !/corporate/i.test(r));

/**
 * Who goes to ComplyAdvantage and the web search, and who to the sanctions
 * lists only (everyone the run lists is screened against those). The company
 * (and its trading name) and its beneficial owners; a listed company alone;
 * the directors when no owner can be named; a private individual themselves.
 */
export function chooseScreened<T extends ScreenCandidate>(candidates: T[], ctx: { individual: boolean; listed: boolean; maxPeople: number }): { basis: ScreenBasis; full: T[]; sanctionsOnly: T[] } {
  const companies = candidates.filter(c => !c.person && (roles(c).some(r => r.startsWith("the company") || r.startsWith("the charity") || r === "corporate trustee") || !!c.abroad));
  let basis: ScreenBasis;
  let people: T[];
  if (ctx.individual) {
    basis = "individual";
    people = candidates.filter(c => c.person && (roles(c).includes("the party") || roles(c).includes("named alongside the party")));
  } else if (candidates.some(c => c.person && c.owner)) {
    basis = "owners";
    // A charity's trustees control it alongside any owner the register names.
    people = [...candidates.filter(c => c.person && c.owner), ...candidates.filter(c => c.person && c.trustee && !c.owner)];
  } else if (candidates.some(c => c.person && c.trustee)) {
    basis = "trustees";
    people = candidates.filter(c => c.person && c.trustee);
  } else if (ctx.listed) {
    basis = "listed";
    people = [];
  } else {
    people = candidates.filter(isManager);
    basis = candidates.some(c => !c.person && c.abroad) ? "owners_abroad" : people.length ? "managers" : "company";
  }
  const full = [...companies, ...people.slice(0, ctx.maxPeople)];
  return { basis, full, sanctionsOnly: candidates.filter(c => c.person && !full.includes(c)) };
}

/** KYC4U's note line: who was screened for public roles and adverse media, and who for sanctions only. */
export const screenedLine = (s: PrecheckScreened): string =>
  `Screened for public roles and adverse media (ComplyAdvantage and a web search): ${SCREEN_BASIS_WORDS[s.basis]}${s.people.length ? `: ${s.people.join(", ")}` : ""}, each person with the date of birth Companies House gives.${s.sanctionsOnly.length ? ` Sanctions lists only: ${s.sanctionsOnly.join(", ")}.` : ""}`;

// ComplyAdvantage's kinds of profile, in words.
export const PROVIDER_KIND_WORDS: Record<string, string> = {
  sanctions: "sanctions",
  pep: "politically exposed person",
  adverse_media: "adverse media",
  warning: "warning list",
  fitness_probity: "fitness and probity",
};
export const providerKindWords = (kind: string): string => PROVIDER_KIND_WORDS[kind] || String(kind || "").replace(/_/g, " ");

export interface KycPrecheckResult {
  kind: "precheck";
  version: number;
  ranAt: string;
  // entityId: the company that signs for the party (crm_trading_entities),
  // when the run was about it rather than the brand (since 18 November 2026).
  party: { companyId: string; name: string; subjectKind: KycPartyKind; contactName: string | null; entityId?: string | null };
  companiesHouse: null | {
    number: string;
    name: string;
    status: string | null;
    type: string | null;
    incorporatedOn: string | null;
    registeredOffice: string | null;
    jurisdiction: string | null;
    sicCodes: string[];
    accountsOverdue: boolean;
    confirmationOverdue: boolean;
    lastAccountsMadeUpTo: string | null;
    lastAccountsType: string | null;
    hasInsolvencyHistory: boolean;
    insolvencyCases: number;
    officers: PrecheckOfficer[];
    owners: RegisterOwner[];
    statements: Array<{ statement: string; words: string; concern: boolean; notifiedOn: string | null }>;
    listing: PrecheckListing | null;
    chain: Array<{ name: string; number: string; individuals: number; companies: number }>;
    // The month and year of birth and nationality since 19 November 2026.
    peopleUpChain: Array<{ name: string; foundAt: string; controls: string[]; dob?: { month?: number | null; year?: number | null } | null; nationality?: string | null }>;
    offshoreOwners: Array<{ name: string; country: string }>;
    // Corporate owners registered outside the UK, on the register or up the
    // chain: Companies House cannot show who owns them (since 20 November
    // 2026; older checks read them from `owners` on read, ownersAbroadOf).
    ownersAbroad?: OwnerAbroad[];
    disqualified: Array<{ officer: string; match: string; dobMatches: boolean | null; url: string | null }>;
    covenant: { grade: string | null; score: number | null; flags: Array<{ level: string; label: string; detail?: string | null }>; gazette: Array<{ title: string; published: string; link: string }> } | null;
    documents: PrecheckDocument[];
  };
  // Why there is no Companies House record to read.
  notAtCompaniesHouse: string | null;
  sanctions: { ran: boolean; lists: string[]; lines: SanctionsLine[]; error: string | null };
  web: { ran: boolean; lines: WebSearchLine[]; skipped: string | null };
  complyAdvantage: { ran: boolean; lines: ProviderLine[]; skipped: string | null };
  // Who was screened for public roles and adverse media (since 19 November 2026).
  screened?: PrecheckScreened;
  // The Register of Overseas Entities, searched by name when the party had no
  // UK company number (since 19 November 2026).
  overseasEntity?: PrecheckOverseasEntity | null;
  // The parent note in the accounts and the GLEIF trace of each company
  // abroad (since 21 November 2026; shared/foreign-owners.ts).
  abroad?: PrecheckAbroad | null;
  // The party itself in GLEIF: a UK company by its Companies House number,
  // else by its name (since 21 November 2026).
  gleif?: PrecheckGleif | null;
  // The Charity Commission's register, read for a charity, a foundation or a
  // charity's corporate trustee (since 21 November 2026; shared/charity-register.ts).
  charity?: PrecheckCharity | null;
  errors: string[];
}

// ── The Register of Overseas Entities ───────────────────────────────────────
//
// An overseas entity that owns or buys UK land, or takes a lease of more than
// seven years, must be on the Register of Overseas Entities (Economic Crime
// (Transparency and Enforcement) Act 2022), and BGP's risk assessment lists
// overseas company registrations among its reporting duties. A party with no
// UK company number is looked for there by its name: exactly one entity of
// that name is read as the company (its managing officers and registered
// beneficial owners are screened like any other), and none found for a name
// whose legal form is foreign is a factor to weigh.
export interface PrecheckOverseasEntity {
  searched: boolean;
  // Found by its name (number, name and status as the register gives them).
  number: string | null;
  name: string | null;
  status: string | null;
  // Entities on the register whose names matched, when not exactly one.
  candidates: number;
  // The name's legal form is foreign (an S.A., GmbH, B.V., LLC and so on).
  looksOverseas: boolean;
  error: string | null;
}

export const isOverseasEntityNumber = (n: unknown): boolean => /^OE\d{6}$/i.test(String(n || "").trim());

// A legal form that only an overseas company carries, at the end of its name.
// "Limited" and "LP" are left out: UK companies use them too.
const FOREIGN_LEGAL_FORM = /(?:^|[\s,(])(s\.?\s?a\.?\s?r\.?\s?l\.?|s\.?\s?[àa]\.?\s?r\.?\s?l\.?|sarl|s\.?\s?a\.?\s?s\.?|s\.?\s?p\.?\s?a\.?|s\.?\s?r\.?\s?l\.?|s\.?\s?a\.?|s\.?\s?l\.?|gmbh|gmbh\s?&\s?co\.?\s?kg|ag|kg|b\.?\s?v\.?|n\.?\s?v\.?|a\/s|aps|oyj?|sp\.?\s?z\s?o\.?\s?o\.?|kft|zrt|inc\.?|incorporated|corp\.?|corporation|l\.?\s?l\.?\s?c\.?|pty\.?(?:\s+ltd\.?)?|pte\.?(?:\s+ltd\.?)?|sdn\.?\s?bhd\.?|bhd\.?|w\.?\s?l\.?\s?l\.?|fzc|fze|fz-?llc|s\.?\s?e\.?|s\.?\s?a\.?\s+de\s+c\.?\s?v\.?|\((?:jersey|guernsey|bvi|british virgin islands|cayman|cayman islands|isle of man|luxembourg|cyprus|gibraltar|malta|bermuda|panama|delaware)\)(?:\s+(?:limited|ltd\.?))?)\s*\.?\s*$/i;
export const looksOverseasName = (name: unknown): boolean => FOREIGN_LEGAL_FORM.test(String(name || "").trim());

// A name as one key for the register search: accents, punctuation and spaces
// gone, "&" read as "and", and a legal form at the end dropped from both
// names, so "Acme Property" finds "ACME PROPERTY S.À R.L." and never "ACME
// PROPERTY HOLDINGS S.À R.L.".
const UK_LEGAL_FORM = /(?:^|[\s,])(limited|ltd\.?|plc|public limited company|llp|lp|limited partnership)\s*\.?\s*$/i;
export function overseasNameKey(name: string): string {
  let n = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  for (let i = 0; i < 2; i++) n = n.replace(FOREIGN_LEGAL_FORM, "").replace(UK_LEGAL_FORM, "").trim();
  return n.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "");
}

/** Which register entry, if any, an overseas entity search found: exactly one whose name matches. */
export function pickOverseasEntity(name: string, items: Array<{ company_number?: string; title?: string; company_type?: string; company_status?: string }>): { found: { number: string; name: string; status: string | null } | null; candidates: number } {
  const oes = items.filter(i => isOverseasEntityNumber(i.company_number) || i.company_type === "registered-overseas-entity");
  const key = overseasNameKey(name);
  const matching = key ? oes.filter(i => i.title && overseasNameKey(String(i.title)) === key) : [];
  if (matching.length !== 1) return { found: null, candidates: matching.length };
  const m = matching[0];
  return { found: { number: String(m.company_number).toUpperCase(), name: String(m.title), status: m.company_status || null }, candidates: 1 };
}

// A private individual's name as a record holds it: "Sandy Macaskill
// (private)" is screened as "Sandy Macaskill".
export const personNameOfRecord = (name: unknown): string =>
  String(name ?? "").replace(/\s*\((?:private|personal|individual|private individual|a person)\)\s*$/i, "").replace(/\s+/g, " ").trim().slice(0, 160);

export const isPrecheckResult = (value: unknown): value is KycPrecheckResult =>
  !!value && typeof value === "object" && (value as any).kind === "precheck";

// ── A check that did not finish ─────────────────────────────────────────────
//
// Companies House was busy (a 429) or did not answer when the check ran, so
// the register was never read: not the company's fault, and not a result.
// The card says so, and the check runs again when the deal's AML box is next
// opened, PRECHECK_RETRY_MINUTES later, at most PRECHECK_AUTO_RUNS_A_DAY
// times a day for one party (Run again always works). A number Companies
// House does not know (a 404) is an answer, not a failure.
export const PRECHECK_RETRY_MINUTES = 10;
export const PRECHECK_AUTO_RUNS_A_DAY = 4;
const PASSING_FAILURE = /\b429\b|\b50[0-9]\b|took longer than|timed? ?out|timeout|aborted|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network/i;

export function precheckUnfinished(result: Pick<KycPrecheckResult, "companiesHouse" | "notAtCompaniesHouse" | "errors">): string | null {
  if (result.companiesHouse) return null;
  const why = String(result.notAtCompaniesHouse || "");
  if (/^Companies House could not be read/i.test(why) && PASSING_FAILURE.test(why)) return why;
  const finding = (result.errors || []).find(e => /^(Finding the company at Companies House|The Register of Overseas Entities):/i.test(e) && PASSING_FAILURE.test(e));
  if (finding) return finding;
  return null;
}

// ── The company, for the deal's AML box ─────────────────────────────────────
//
// Woody, 19 November 2026: "in this box we need to see the company info".
// What the register says about the company the checks were about.

// The Standard Industrial Classification codes BGP meets most, in words.
// Any other code is shown as its number.
const SIC_WORDS: Record<string, string> = {
  "41100": "Development of building projects",
  "41201": "Construction of commercial buildings",
  "46190": "Agents in the sale of a variety of goods",
  "47110": "Retail in non-specialised stores (food)",
  "47190": "Other retail in non-specialised stores",
  "47710": "Retail sale of clothing",
  "47721": "Retail sale of footwear",
  "47770": "Retail sale of watches and jewellery",
  "47910": "Retail via mail order or the internet",
  "55100": "Hotels and similar accommodation",
  "56101": "Licensed restaurants",
  "56102": "Unlicensed restaurants and cafes",
  "56103": "Take-away food shops and mobile food stands",
  "56210": "Event catering",
  "56290": "Other food services",
  "56301": "Licensed clubs",
  "56302": "Public houses and bars",
  "59140": "Cinemas",
  "64201": "Holding company (agricultural)",
  "64202": "Holding company (production)",
  "64203": "Holding company (construction)",
  "64204": "Holding company (distribution)",
  "64205": "Holding company (financial services)",
  "64209": "Activities of other holding companies",
  "64301": "Investment trusts",
  "64303": "Venture and development capital",
  "64999": "Financial intermediation not elsewhere classified",
  "68100": "Buying and selling of own real estate",
  "68201": "Renting and operating of housing association real estate",
  "68202": "Letting and operating of conference and exhibition centres",
  "68209": "Other letting and operating of own or leased real estate",
  "68310": "Real estate agencies",
  "68320": "Management of real estate on a fee or contract basis",
  "70100": "Activities of head offices",
  "70229": "Management consultancy",
  "82990": "Other business support services",
  "93110": "Operation of sports facilities",
  "93130": "Fitness facilities",
  "93290": "Other amusement and recreation activities",
  "96020": "Hairdressing and other beauty treatment",
  "96040": "Physical well-being activities",
  "99999": "Dormant company",
};
export const sicWords = (code: string): string => SIC_WORDS[String(code || "").trim()] ? `${code} ${SIC_WORDS[String(code).trim()]}` : String(code || "");

export interface PrecheckCompany {
  name: string;
  number: string;
  status: string;
  type: string | null;
  incorporatedOn: string | null;
  registeredOffice: string | null;
  business: string[];
  // Listed on a market, in words, and what that means for the checks.
  listing: string | null;
  listingNote: string | null;
  directors: string[];
  owners: Array<{ name: string; control: string }>;
  ownerNote: string | null;
  chain: string[];
  accounts: string | null;
  warnings: string[];
  documents: Array<{ title: string; onFile: boolean }>;
  registerUrl: string;
  // On the Register of Overseas Entities (an OE number), in words.
  overseasEntity?: string | null;
  // Corporate owners registered abroad, on the register or up the chain: the
  // party goes to KYC4U (Woody, 21 November 2026).
  ownersAbroad?: Array<{ name: string; country: string; foundAt: string | null; via?: OwnerAbroad["via"] }>;
  // What the accounts' parent note and GLEIF show (21 November 2026), in words.
  trace?: string[];
  // The company's own GLEIF record (its LEI and parents), in one line.
  gleif?: string | null;
  // Each director's and individual owner's identity verification at Companies House.
  identity?: Array<{ name: string; role: string; state: IdvState; words: string }>;
  // Whether it trades, as the register shows (dormant, non-trading, newly formed).
  trading?: { trading: boolean | null; words: string | null };
  // Each individual owner's nationality and country of residence, on the
  // register and up the chain, for the risk assessment's owners table.
  ownerDetails?: Array<{ name: string; nationality: string | null; residence: string | null }>;
}

export function precheckCompany(result: KycPrecheckResult | null): PrecheckCompany | null {
  const ch = result?.companiesHouse;
  if (!ch) return null;
  const status = (ch.status || "status not given").replace(/-/g, " ");
  const listing = ch.listing
    ? ch.listing.viaParent ? `Owned through one company at each level by ${ch.listing.company}, which is ${LISTING_WORDS[ch.listing.market]}` : `${LISTING_WORDS[ch.listing.market][0].toUpperCase()}${LISTING_WORDS[ch.listing.market].slice(1)}`
    : null;
  const listingNote = ch.listing
    ? [
        "No beneficial owners to identify: the company itself is identified and verified from the register, and simplified due diligence may apply.",
        ch.listing.viaParent ? "KYC4U to confirm the chain." : "",
        listingSettled(ch.listing.market) ? "" : "KYC4U to confirm the market's disclosure rules are equivalent.",
      ].filter(Boolean).join(" ")
    : null;
  const trading = tradingState(ch);
  const identity = precheckIdentity(ch);
  const overdueIdv = identity.filter(i => i.state === "overdue");
  const warnings = [
    ch.status && ch.status !== "active" ? `Companies House shows it as ${status}` : "",
    ch.hasInsolvencyHistory ? `Insolvency history${ch.insolvencyCases ? ` (${ch.insolvencyCases} case${ch.insolvencyCases === 1 ? "" : "s"})` : ""}` : "",
    ch.accountsOverdue ? "Accounts overdue at Companies House" : "",
    ch.confirmationOverdue ? "Confirmation statement overdue" : "",
    trading.words || "",
    overdueIdv.length ? `Identity verification overdue at Companies House: ${overdueIdv.map(i => i.name).join(", ")}` : "",
    ...ownersAbroadOf(ch).map(a => `Owned through ${a.name}, registered in ${a.country}${a.foundAt ? ` (owner of ${a.foundAt})` : a.via === "accounts" ? " (named in its accounts; the register names no owner)" : a.via === "gleif" ? " (its parent in GLEIF; the register names no owner)" : ""}: Companies House cannot show who owns it`),
  ].filter(Boolean);
  return {
    name: ch.name,
    number: ch.number,
    status: status[0].toUpperCase() + status.slice(1),
    type: ch.type ? companyTypeWords(ch.type) : null,
    incorporatedOn: ch.incorporatedOn,
    registeredOffice: ch.registeredOffice,
    business: (ch.sicCodes || []).map(sicWords),
    listing,
    listingNote,
    directors: ch.officers.filter(o => /director|member/i.test(o.role)).map(o => o.name),
    owners: ch.owners.map(o => ({ name: o.name, control: ownerControlLine(o) || "significant control" })),
    ownerNote: ch.listing ? null : ch.owners.length ? null : ch.statements.length ? ch.statements.map(s => s.words).join("; ") : "No one with significant control is on the register.",
    chain: ch.chain.map(c => `${c.name} (${c.number})`),
    accounts: ch.lastAccountsMadeUpTo ? `Made up to ${ch.lastAccountsMadeUpTo}${ch.lastAccountsType ? `, ${ch.lastAccountsType}` : ""}` : null,
    warnings,
    documents: ch.documents.map(d => ({ title: d.title, onFile: !!d.kycDocumentId })),
    registerUrl: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(ch.number)}`,
    ownersAbroad: ownersAbroadOf(ch).map(a => ({ name: a.name, country: a.country, foundAt: a.foundAt, ...(a.via ? { via: a.via } : {}) })),
    trace: abroadTraceLines(result),
    gleif: gleifPartyLine(result),
    identity,
    trading: { trading: trading.trading, words: trading.words },
    ownerDetails: [
      ...ch.owners.filter(o => o.kind === "individual").map(o => ({ name: o.name, nationality: o.nationality || null, residence: o.residence || null })),
      ...ch.peopleUpChain.map(u => ({ name: u.name, nationality: u.nationality || null, residence: null })),
    ],
    overseasEntity: isOverseasEntityNumber(ch.number)
      ? `An overseas entity on the Register of Overseas Entities${result?.overseasEntity?.number ? ", found by its name: check it is the same company" : ""}. Its home register's extract is still asked for.`
      : null,
  };
}

// The column the readers already use (kyc_investigations.sanctions_match):
// true for a possible match on either list or with ComplyAdvantage, false
// when every screen ran clear, null when the lists could not be screened.
export function precheckSanctionsMatch(result: Pick<KycPrecheckResult, "sanctions" | "complyAdvantage"> & { companiesHouse?: KycPrecheckResult["companiesHouse"] }): boolean | null {
  const provider = result.complyAdvantage.lines.some(l => l.status === "possible" && l.types.some(t => /sanction|warning/.test(t)))
    || !!result.companiesHouse?.owners.some(o => o.sanctioned);
  if (!result.sanctions.ran) return provider ? true : null;
  return provider || result.sanctions.lines.some(l => l.outcome === "possible");
}

// ── What is still to ask ────────────────────────────────────────────────────

export interface PrecheckAskInput {
  subjectKind: KycPartyKind;
  ukRegistered: boolean;
  listing: PrecheckListing | null;
  owners: RegisterOwner[];
  peopleUpChain: Array<{ name: string; foundAt: string; controls: string[] }>;
  directors: string[];
  accounts: { madeUpTo: string | null; dormant: boolean } | null;
  // Corporate owners registered abroad (20 November 2026).
  ownersAbroad?: Array<{ name: string; country: string }>;
}

export interface PrecheckAsks {
  docs: KycDocKey[];
  notAsked: Array<{ key: KycDocKey; reason: string }>;
  // The owners on the register, shown to the client to confirm in place of
  // asking for a chart.
  confirmOwners: Array<{ name: string; detail: string }> | null;
  // The people whose ID is asked for, where the register names them.
  ownerNames: string[];
  // The companies abroad whose owners the structure chart is to show.
  ownersAbroad?: Array<{ name: string; country: string }>;
}

export function askInputFrom(result: KycPrecheckResult | null): PrecheckAskInput | null {
  if (!result) return null;
  const ch = result.companiesHouse;
  return {
    subjectKind: result.party.subjectKind,
    // An overseas entity on the Register of Overseas Entities is still
    // registered abroad: its home register's extract is asked for.
    ukRegistered: !!ch && !isOverseasEntityNumber(ch.number),
    listing: ch?.listing || null,
    owners: ch?.owners || [],
    peopleUpChain: ch?.peopleUpChain || [],
    directors: (ch?.officers || []).filter(o => /director|member/i.test(o.role)).map(o => o.name),
    ownersAbroad: ownersAbroadOf(ch).map(o => ({ name: o.name, country: o.country })),
    accounts: ch?.documents.some(d => d.kind === "accounts" && d.kycDocumentId)
      ? { madeUpTo: ch.lastAccountsMadeUpTo, dormant: /dormant/i.test(String(ch.lastAccountsType || "")) }
      : null,
  };
}

const monthsSince = (iso: string | null, today: Date): number | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : (today.getTime() - d.getTime()) / (30.44 * 86400000);
};

export function precheckAsks(input: PrecheckAskInput | null, ctx: { kind: KycPartyKind; role: string | null | undefined; idCheck: boolean; contactName: string | null | undefined; today?: Date }): PrecheckAsks {
  const docs = defaultKycDocs(ctx.kind, ctx.role, ctx.idCheck);
  const notAsked: PrecheckAsks["notAsked"] = [];
  const drop = (key: KycDocKey, reason: string) => {
    const at = docs.indexOf(key);
    if (at < 0) return;
    docs.splice(at, 1);
    notAsked.push({ key, reason });
  };
  if (!input || ctx.kind !== "company") return { docs, notAsked, confirmOwners: null, ownerNames: [] };
  const today = ctx.today || new Date();
  let confirmOwners: PrecheckAsks["confirmOwners"] = null;
  let ownerNames: string[] = [];

  if (input.listing) {
    const where = LISTING_WORDS[input.listing.market];
    const who = input.listing.viaParent ? `Owned through one company at each level by ${input.listing.company}, which is ${where}` : `${where[0].toUpperCase()}${where.slice(1)}`;
    // The regulation names the listed company itself: a subsidiary reached
    // through a chain, or a market abroad, is for KYC4U to confirm.
    const check = [
      input.listing.viaParent ? " KYC4U to confirm the chain." : "",
      listingSettled(input.listing.market) ? "" : " KYC4U to confirm the market's disclosure rules are equivalent.",
    ].join("");
    const reason = `${who} (Companies House PSC exemption${input.listing.since ? ` since ${input.listing.since}` : ""}): no beneficial owners to identify.${check}`;
    drop("ownership", reason);
    drop("owner_ids", reason);
  } else if (input.owners.length && input.ownersAbroad?.length) {
    // A company registered abroad owns it: Companies House cannot show who
    // owns that company, so the structure chart and the owners' IDs are asked
    // for (20 November 2026). The client still confirms the register's list,
    // and any person the register names does their own checks.
    // The owners' IDs step is for the people behind the company abroad, so
    // it names nobody: a person the register names has a link of their own.
    confirmOwners = input.owners.map(o => ({ name: o.name, detail: ownerControlLine(o) || "a person with significant control" }));
  } else if (input.owners.length) {
    confirmOwners = input.owners.map(o => ({ name: o.name, detail: ownerControlLine(o) || "a person with significant control" }));
    const people = [
      ...input.owners.filter(o => o.kind === "individual").map(o => o.name),
      ...input.peopleUpChain.map(p => p.name),
    ];
    ownerNames = [...new Set(people)];
    drop("ownership", `Companies House lists ${input.owners.length === 1 ? "its owner" : `its ${input.owners.length} owners`}: the client is asked to confirm the list instead.`);
    // Each owner the register names does their own identity check and sends
    // their own proof of address, on a link of their own (Woody, 19 November
    // 2026: one upload step for every owner ticked itself on the first file).
    // The person acting is one of the owners when their name is on the list.
    const others = ownerNames.filter(n => !(ctx.contactName && personNamesMatch(ctx.contactName, n)));
    if (others.length) drop("owner_ids", `Each owner gets a link of their own for their identity check and proof of address: ${others.map(personDisplayName).join(", ")}. Send them from People to check on the transaction's AML card, or the client passes them on from their page.`);
    else drop("owner_ids", "The person you are asking is the only owner the register names: their own identity check and proof of address cover it.");
  }

  if (isRegisterDirector(ctx.contactName, input.directors)) {
    drop("authority", `${ctx.contactName} is a director at Companies House.`);
  }

  if (!input.ukRegistered && !docs.includes("company_documents")) docs.push("company_documents");

  if (String(ctx.role || "").toLowerCase() === "tenant" && input.accounts && !input.accounts.dormant) {
    const age = monthsSince(input.accounts.madeUpTo, today);
    if (age !== null && age <= 24) {
      drop("source_of_funds", `Its latest accounts, made up to ${input.accounts.madeUpTo}, were downloaded from Companies House and are on file.`);
    }
  }
  return { docs, notAsked, confirmOwners, ownerNames, ...(input.ownersAbroad?.length ? { ownersAbroad: input.ownersAbroad } : {}) };
}

// ── Which screening matches are red flags (Woody, 19 November 2026) ─────────
// A match on a bare name too often finds someone else of the same name: the
// checks before asking flagged every officer of BGP's own companies. Woody
// chose "Tighten":
//   - a sanctions or warning-list match stays a red flag, whatever its score;
//   - a public-role (PEP) match is one only when the profile's birth year
//     agrees with the person's, or ComplyAdvantage scores it 60% or more;
//   - adverse media and every other kind only when the birth year agrees, or
//     the score is 90% or more (ComplyAdvantage's own starting points);
//   - a profile ComplyAdvantage matched but whose details could not be read
//     stays a red flag: there is nothing to judge it by;
//   - every other match is a possible namesake to check: listed on the card
//     and in KYC4U's note, never a red flag;
//   - a web result the search marks "may be about someone else of the same
//     name" is listed the same way, not flagged.
//
// The date of birth decides (Woody, later on 19 November 2026: "comply
// advantage not picking up DOB which can get from companies house for
// everyone ... currently showing red flags for random people with similar
// names? whats the fix?"). On deal #4491 a 70% public-role match was "rupert
// smith" for Rupert Bentley-Smith and "caroline roberts" for Charlotte
// Caroline Roberts: ComplyAdvantage's score says how much of the name
// matched (70% when every word of one name is in the other, 20% for a
// spelling variant), not whether it is the same person. So for a person
// screened with their date of birth from Companies House:
//   - a profile whose date of birth differs is set aside before it is kept
//     (server/comply-advantage.ts);
//   - a profile whose date of birth agrees is a red flag, of any kind;
//   - a profile with no date of birth is a possible namesake to check, never
//     a red flag: nothing ties it to the person (the client's own answer to
//     the question about public roles still covers a PEP);
//   - a sanctions match stays a red flag unless the dates of birth differ.
// A person screened without a date of birth keeps the bars, a warning list
// judged as anything else (90%). A company, and any check from before this
// change, keeps the rule above.
export const PROVIDER_FLAG_BARS = { pep: 0.6, other: 0.9 } as const;
// Only a sanctions match is a red flag whatever its score. A warning list
// (tax defaulters, disqualified directors and the like) was too, until Woody
// saw "buffalo bill restaurant" on Ireland's Revenue Defaulters List at a 20%
// match raised against BILLS RESTAURANTS LTD. (23 November 2026: "why is it
// picking up adversea media on buffalow bills restruants its a waste if
// time"): a warning list is now judged as anything else (90%), and for a
// company one spelt differently is set aside (providerSpellingVariant).
const ALWAYS_FLAG_KIND = /sanction/;

export function providerMatchFlags(m: ProviderMatch, line?: Pick<ProviderLine, "person" | "dobKnown">): boolean {
  const kind = String(m.kind || "");
  const dated = line?.person === true && typeof line.dobKnown === "boolean";
  if (dated ? /sanction/.test(kind) : ALWAYS_FLAG_KIND.test(kind)) return true;
  // A match from before this rule with no profile behind it could not be read.
  if (m.unread ?? !m.profileId) return true;
  if (m.birthYearAgrees === true) return true;
  if (dated && line!.dobKnown) return false;
  return m.score != null && m.score >= (kind === "pep" ? PROVIDER_FLAG_BARS.pep : PROVIDER_FLAG_BARS.other);
}

// ── Adverse media on a name spelt differently (Woody, 21 November 2026:
// "comply advantage keeps hitting miss spells of the names and picking up
// adverse media on things not spelt the same but are similar", then "Yes want
// it"). ComplyAdvantage's fuzzy matching brings back profiles whose names are
// only like the person's ("Jack Barrett" for Jack Barratt, "Caroline Roberts"
// for Charlotte Roberts). An adverse media profile is kept only when its name
// is spelt as theirs: for a person, their surname is all there and every other
// word of the profile's name is one of their names (initials aside); for
// a company, every word of one name is in the other once the legal form
// ("Limited", "plc") is left out. Anything else is a spelling variant: set
// aside, counted and listed for the officers, never a red flag or a namesake
// to check. A profile whose date of birth agrees with the person's is kept
// however it is spelt. Sanctions, public roles, warning lists and fitness and
// probity are never set aside on spelling: people on those lists are often
// recorded under other spellings and transliterations of their names.
const NAME_SUFFIXES = new Set(["jr", "jnr", "junior", "sr", "snr", "senior", "ii", "iii", "iv", "aka"]);
const personWords = (s: string): string[] => nameTokens(s).filter(w => !NAME_SUFFIXES.has(w));

/** A person's name as forenames and surname: the register's "SURNAME, Forenames", else the last word is the surname. */
export function personNameParts(raw: string): { forenames: string[]; surname: string[] } {
  const text = String(raw || "");
  const comma = text.indexOf(",");
  if (comma > 0) {
    const surname = personWords(text.slice(0, comma)), forenames = personWords(text.slice(comma + 1));
    if (surname.length && forenames.length) return { forenames, surname };
  }
  const words = personWords(text);
  return { forenames: words.slice(0, -1), surname: words.slice(-1) };
}

/** Whether a profile's name is spelt as the screened name: the same words in any order (initials and legal forms aside), nothing spelt differently. */
export function nameSpeltAsTheirs(screened: string, profile: string, person: boolean): boolean {
  if (person) {
    const s = personNameParts(screened);
    const p = personWords(profile);
    if (!s.surname.length || !p.length) return true;
    const own = new Set([...s.forenames, ...s.surname]);
    return s.surname.every(w => p.includes(w)) && p.every(w => own.has(w));
  }
  const a = nameTokens(screened, true), b = nameTokens(profile, true);
  if (!a.length || !b.length) return true;
  return a.every(w => b.includes(w)) || b.every(w => a.includes(w));
}

const providerLineIsPerson = (line: Pick<ProviderLine, "name" | "person">): boolean =>
  line.person === true || (line.person === undefined && !CORPORATE_NAME.test(line.name));

/**
 * An adverse media profile spelt differently from the person or company
 * screened, with no date of birth tying it to them; for a company, a
 * warning-list or fitness and probity profile too (23 November 2026). A
 * person's warning-list profile is never set aside on spelling: it is judged
 * by the bars, or by the date of birth.
 */
export function providerSpellingVariant(m: ProviderMatch, line: Pick<ProviderLine, "name" | "person">): boolean {
  const kind = String(m.kind || "");
  const companyList = !providerLineIsPerson(line) && /warning|fitness/.test(kind);
  if (kind !== "adverse_media" && !companyList) return false;
  if (m.birthYearAgrees === true) return false;
  // A profile that could not be read has no name to judge: it stays as the bars say.
  if ((m.unread ?? !m.profileId) || !m.name) return false;
  return !nameSpeltAsTheirs(line.name, m.name, providerLineIsPerson(line));
}

/** The subjects ComplyAdvantage was asked to screen and did not (Mesh refused or failed them). */
export function providerNotScreened(result: Pick<KycPrecheckResult, "complyAdvantage">): ProviderLine[] {
  return result.complyAdvantage.ran ? result.complyAdvantage.lines.filter(l => l.status === "error") : [];
}
const notScreenedWords = (l: ProviderLine) => `${l.name}${l.detail ? ` (${l.detail})` : ""}`;
/** ComplyAdvantage left out because it is not set up is not a failure; refused or not answering is. */
export const caSkipIsFailure = (skipped: string | null | undefined): boolean => !!skipped && !/^no ComplyAdvantage keys/i.test(skipped);

/** A ComplyAdvantage line's matches, split into red flags, possible namesakes and spelling variants set aside. */
export function splitProviderMatches(line: ProviderLine): { flagged: ProviderMatch[]; namesakes: ProviderMatch[]; variants: ProviderMatch[]; unjudged: boolean } {
  if (line.status !== "possible") return { flagged: [], namesakes: [], variants: [], unjudged: false };
  const all = line.matches || [];
  // An older check kept only the kinds of profile matched: nothing to judge, so it stays a flag.
  if (!all.length) return { flagged: [], namesakes: [], variants: [], unjudged: true };
  const variants = all.filter(m => providerSpellingVariant(m, line));
  const matches = all.filter(m => !variants.includes(m));
  return { flagged: matches.filter(m => providerMatchFlags(m, line)), namesakes: matches.filter(m => !providerMatchFlags(m, line)), variants, unjudged: false };
}

export interface PrecheckSpellingVariant { name: string; profile: string; source: string | null; score: number | null }

/** The profiles a run set aside because their names are spelt differently (adverse media; a company's warning lists too). */
export function precheckSpellingVariants(result: Pick<KycPrecheckResult, "complyAdvantage">): PrecheckSpellingVariant[] {
  return result.complyAdvantage.lines.flatMap(line => splitProviderMatches(line).variants.map(m => ({ name: line.name, profile: m.name, source: m.source, score: m.score })));
}
const variantWords = (v: PrecheckSpellingVariant) => `${v.name}: "${v.profile}"${v.source ? `, ${v.source}` : ""}${v.score != null ? `, match ${Math.round(v.score * 100)}%` : ""}`;

const CORPORATE_NAME = /\b(limited|ltd|llp|plc|lp|inc|corp|corporation|company|holdings|group|partnership|trust|estates)\b/i;
/** A web line about a company, not a person (older lines are read from the name). */
export const webLineIsCompany = (line: Pick<WebSearchLine, "name" | "person">): boolean =>
  line.person === false || (line.person === undefined && CORPORATE_NAME.test(line.name));

export interface PrecheckNamesake { name: string; via: "ComplyAdvantage" | "web search"; what: string; url: string | null }

/** The possible namesakes of a run: matches below the bars and web results that may be about someone else. */
export function precheckNamesakes(result: Pick<KycPrecheckResult, "complyAdvantage" | "web">): PrecheckNamesake[] {
  const out: PrecheckNamesake[] = [];
  for (const line of result.complyAdvantage.lines) {
    for (const m of splitProviderMatches(line).namesakes) {
      out.push({
        name: line.name, via: "ComplyAdvantage", url: null,
        what: [providerKindWords(m.kind), m.name && m.name !== line.name ? `profile "${m.name}"` : "", m.source || "",
          m.score != null ? `match ${Math.round(m.score * 100)}%` : "no match score",
          m.birthYearAgrees === false ? "birth year differs" : line.person && line.dobKnown && m.birthYearAgrees == null ? "no date of birth on the profile" : ""].filter(Boolean).join(", "),
      });
    }
  }
  for (const line of result.web.lines) {
    for (const f of webFindingsOf(line).filter(x => x.unsureIdentity)) {
      out.push({ name: line.name, via: "web search", url: f.url, what: `${f.kind === "public_role" ? (webLineIsCompany(line) ? "ownership by the state or a politically exposed person" : "public role") : "adverse media"}: ${f.summary}` });
    }
  }
  return out;
}

// ── Red flags ───────────────────────────────────────────────────────────────

// Secrecy and high-risk places a corporate owner can be registered in: a
// reason for KYC4U to look, never a verdict. The FATF call-for-action list
// (Iran, North Korea, Myanmar) and the usual secrecy jurisdictions. Monaco
// since 20 November 2026 (Woody, on Tureddi Group Limited, owned through a
// Monaco société civile: "the holding company for this business is in
// Monaco..? What do you think?"): a tax haven (BGP's AML policy: "Non-resident
// customers, especially companies in tax havens"), on FATF's grey list from
// June 2024 to 30 October 2026, and on the EU's list of high-risk third
// countries since August 2025 (Delegated Regulation (EU) 2025/1184).
const OFFSHORE = /\b(british virgin islands|bvi|cayman|panama|seychelles|belize|marshall islands|bahamas|anguilla|turks and caicos|vanuatu|samoa|liechtenstein|monaco|monegasque|iran|north korea|korea, democratic|myanmar|burma)\b/i;
export const isOffshoreCountry = (country: string | null | undefined): boolean => OFFSHORE.test(String(country || ""));

// Why a place is on that list, where there is more to say than "secrecy".
const OFFSHORE_NOTES: Array<[RegExp, string]> = [
  [/\b(monaco|monegasque)\b/i, "Monaco is a tax haven, was on FATF's grey list from June 2024 until 30 October 2026, and is on the EU's list of high-risk third countries (since August 2025). BGP's AML policy: \"Non-resident customers, especially companies in tax havens\"."],
];
export const offshoreNote = (country: string | null | undefined): string | null =>
  OFFSHORE_NOTES.find(([re]) => re.test(String(country || "")))?.[1] || null;

// ── Owners registered abroad (Woody, 20 November 2026) ──────────────────────
// A company registered outside the UK that owns or controls the party (on the
// register, or up its ownership chain) is a dead end for Companies House: it
// cannot show who owns that company. The beneficial owners are still there to
// identify (MLR 2017 reg 28(4): "take reasonable measures to understand the
// ownership and control structure"; BGP's AML policy: "Every organisation will
// have UBOs, and it is therefore necessary to identify and verify them"), so
// the client is asked for a structure chart up to the people and their IDs.
// The directors do not stand in for them under reg 28(6) meanwhile: that is
// only once every means of finding the owners is exhausted.
export interface OwnerAbroad {
  name: string;
  country: string;
  registrationNumber: string | null;
  controls: string[];
  // The company up the chain it owns, when it is not the party itself.
  foundAt: string | null;
  // Where it was found: the register, up the chain, or named in the party's
  // accounts (or as its parent in GLEIF) when the register names no owner
  // (since 21 November 2026).
  via?: "register" | "chain" | "accounts" | "gleif";
}

/**
 * Where a corporate owner's register is: "uk" when the words name the UK or
 * Companies House, "abroad" when they name anywhere else, null when nothing is
 * given (or a bare "Registrar of Companies", which could be either).
 */
export function ownerRegister(country: string | null | undefined): "uk" | "abroad" | null {
  const t = String(country || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  if (!t || /^(the )?(registrar|register) of companies$/.test(t)) return null;
  if (/new south wales/.test(t)) return "abroad";
  if (/\b(united kingdom|great britain|britain|england|wales|scotland|northern ireland|companies house|uk|u\.k\.?|gb)\b/.test(t)) return "uk";
  return "abroad";
}

const sameOwnerName = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** The corporate owners registered abroad: as the run stored them, or read from the register's owners for an older check. */
export function ownersAbroadOf(ch: KycPrecheckResult["companiesHouse"] | null | undefined): OwnerAbroad[] {
  if (!ch || ch.listing) return [];
  const out: OwnerAbroad[] = [...(ch.ownersAbroad || [])];
  for (const o of ch.owners) {
    if (o.kind !== "company" && o.kind !== "legal_person") continue;
    if (ownerRegister(o.country) !== "abroad" || out.some(x => sameOwnerName(x.name, o.name))) continue;
    out.push({ name: o.name, country: String(o.country), registrationNumber: o.registrationNumber || null, controls: o.controls, foundAt: null });
  }
  return out;
}

/** The corporate owners in secrecy or high-risk places, on the register or up the chain. */
export function offshoreOwnersOf(ch: KycPrecheckResult["companiesHouse"] | null | undefined): Array<{ name: string; country: string; foundAt: string | null }> {
  if (!ch) return [];
  const out: Array<{ name: string; country: string; foundAt: string | null }> = ch.offshoreOwners.map(o => ({ ...o, foundAt: null }));
  for (const o of [...ch.owners.filter(x => x.kind !== "individual").map(x => ({ name: x.name, country: String(x.country || ""), foundAt: null as string | null })),
    ...ownersAbroadOf(ch).map(x => ({ name: x.name, country: x.country, foundAt: x.foundAt }))]) {
    if (isOffshoreCountry(o.country) && !out.some(x => sameOwnerName(x.name, o.name))) out.push(o);
  }
  return out;
}

/** "Scp Aaa Invest (Monaco)", "A Ltd (Jersey) and B SA (Luxembourg)". */
export const ownersAbroadWords = (owners: ReadonlyArray<Pick<OwnerAbroad, "name" | "country">>): string => {
  const one = owners.map(o => `${o.name} (${o.country})`);
  return one.length < 2 ? one.join("") : `${one.slice(0, -1).join(", ")} and ${one[one.length - 1]}`;
};

/**
 * What the app traced past Companies House, in lines: the accounts' parent
 * note (with the words it read) and each company abroad in GLEIF (Woody,
 * 21 November 2026). For the AML box, KYC4U's note and the AML file.
 */
// A UK company's top parent abroad in GLEIF, as an owner abroad, when the
// register names no person who owns it and no owner abroad is known (21
// November 2026): the same rule as the parent the accounts name.
export function gleifOwnerAbroad(ch: KycPrecheckResult["companiesHouse"] | null | undefined, g: PrecheckGleif | null | undefined): OwnerAbroad | null {
  if (!ch || ch.listing || !g || g.trace.status !== "found") return null;
  const namesOwners = ch.owners.some(o => o.kind === "individual") || ch.peopleUpChain.length > 0;
  if (namesOwners || ownersAbroadOf(ch).length) return null;
  const foreign = g.trace.parents.filter(p => !gleifUkRegister(p) && ownerRegister(p.jurisdiction || p.country) === "abroad");
  const top = foreign[foreign.length - 1];
  if (!top) return null;
  return { name: top.name, country: countryFromCode(top.jurisdiction || top.country), registrationNumber: top.registeredAs || null, controls: [], foundAt: null, via: "gleif" };
}

/** A country from GLEIF's code ("DK" is Denmark, "US-DE" the United States). */
export function countryFromCode(code: string | null | undefined): string {
  const c = String(code || "").trim().toUpperCase().split("-")[0];
  if (!/^[A-Z]{2}$/.test(c)) return String(code || "").trim() || "country not given";
  try {
    return new Intl.DisplayNames(["en-GB"], { type: "region" }).of(c) || c;
  } catch {
    return c;
  }
}

/** The party's own GLEIF record in one line (a UK party too, since 21 November 2026), or null. */
export const gleifPartyLine = (result: Partial<Pick<KycPrecheckResult, "gleif">> | null | undefined): string | null =>
  result?.gleif && result.gleif.trace.status !== "skipped" ? gleifPartyWords(result.gleif) : null;

export function abroadTraceLines(result: Pick<KycPrecheckResult, "abroad"> | null | undefined): string[] {
  const a = result?.abroad;
  if (!a) return [];
  const lines: string[] = [];
  const note = a.accounts;
  if (note) {
    const when = note.madeUpTo ? ` to ${precheckDay(note.madeUpTo)}` : "";
    if (note.status === "found") {
      for (const l of note.lines.slice(0, 4)) lines.push(`The accounts${when}${note.via === "scan" ? `, read from the scanned filing${l.page ? ` (page ${l.page})` : ""}` : ""}: ${parentLineWords(l)} ("${l.words}")`);
    } else if (note.status === "none") {
      lines.push(`The accounts${when} name no parent or controlling party.`);
    } else if (note.unread) {
      lines.push(`The accounts${when} were not read for a parent: ${note.unread}.`);
    }
  }
  for (const t of a.traced) lines.push(`GLEIF: ${gleifTraceWords(t)}`);
  return lines;
}

const DISTRESS = /liquidation|receivership|administration|insolvency|voluntary-arrangement|dissolved|removed|struck|closed/i;

// sanctionsCurrent: this pre-check is the party's latest screening, so its
// sanctions lines stand (a later screening replaces them).
export function precheckRedFlags(result: KycPrecheckResult, opts: { sanctionsCurrent: boolean }): KycRedFlag[] {
  const flags: KycRedFlag[] = [];
  const at = result.ranAt || null;
  const source = "BGP's checks before asking";
  const k = flagKeyPart;
  if (opts.sanctionsCurrent) {
    for (const line of result.sanctions.lines.filter(l => l.outcome === "possible")) {
      const m = line.matches[0];
      flags.push({
        kind: "sanctions",
        label: `Possible sanctions match for ${line.name} (${line.role})`,
        detail: m ? `${sanctionsListName(m.source)}: ${m.name}${m.regime ? `, ${m.regime}` : ""}. ${m.why}` : null,
        source: `${source}: sanctions lists`,
        at,
        key: `sanctions:${k(line.name)}`,
        evidence: line.matches.map(x => `entry:${x.source}:${k(x.name)}`).sort(),
        facts: line.matches.map(x => ({
          label: sanctionsListName(x.source),
          value: [x.name, x.regime, x.designationType, x.dob ? `born ${x.dob}` : "", x.nationality].filter(Boolean).join(", ") + `. ${x.why}`,
        })),
      });
    }
    for (const line of result.complyAdvantage.lines) {
      // Only the matches over the bars (providerMatchFlags); the rest are possible namesakes.
      const { flagged, namesakes, variants, unjudged } = splitProviderMatches(line);
      if (!flagged.length && !unjudged) continue;
      const matches = flagged;
      const types = unjudged ? line.types : [...new Set(flagged.map(m => m.kind).filter(Boolean))];
      const profiles = [...new Set(matches.map(m => m.profileId).filter((p): p is string => !!p))];
      const facts: KycFlagFact[] = matches.map(m => ({
        label: `Matched profile: ${providerKindWords(m.kind)}`,
        value: [m.name, m.source ? `listed in ${m.source}` : "", m.score != null ? `match ${Math.round(m.score * 100)}%` : ""].filter(Boolean).join(" · "),
      }));
      for (const m of matches) for (const item of m.media.slice(0, 3)) facts.push({ label: "Article", value: [item.title, item.date].filter(Boolean).join(", ") || "an article", url: item.url });
      if (!matches.length) {
        facts.push({ label: "Kinds of profile matched", value: line.types.map(providerKindWords).join(", ") || "not given" });
        facts.push({ label: "Profiles", value: "This check kept only the kinds of profile ComplyAdvantage matched, not the profiles themselves. Run the check again to see them here, or look the name up in ComplyAdvantage Mesh." });
      }
      if (namesakes.length) facts.push({ label: "Also matched, below the bars", value: `${namesakes.length} possible namesake${namesakes.length === 1 ? "" : "s"}, listed under Checked before asking` });
      if (variants.length) facts.push({ label: "Set aside, spelt differently", value: `${variants.length} adverse media profile${variants.length === 1 ? "" : "s"} under a name spelt differently from ${line.name}'s, listed under Checked before asking` });
      if (line.customerId) facts.push({ label: "ComplyAdvantage customer", value: line.customerId });
      flags.push({
        kind: "provider_screen",
        label: `ComplyAdvantage match for ${line.name}`,
        detail: types.map(providerKindWords).join(", ") || line.detail,
        source: `${source}: ComplyAdvantage`,
        at,
        key: `ca:${k(line.name)}`,
        evidence: [...types.map(t => `type:${t}`), ...profiles.map(p => `profile:${p}`)].sort(),
        facts,
      });
    }
  }
  for (const line of result.web.lines) {
    for (const kind of ["public_role", "adverse_media"] as const) {
      const sure = webFindingsOf(line).filter(f => f.kind === kind && !f.unsureIdentity);
      if (!sure.length) continue;
      // For a company the search asks whether the state or a politically exposed person owns or controls it.
      const label = kind === "adverse_media" ? `Adverse media about ${line.name}`
        : webLineIsCompany(line) ? `Possibly owned or controlled by the state or a politically exposed person: ${line.name}` : `Possible public role for ${line.name}`;
      flags.push({
        kind: kind === "public_role" ? "web_pep" : "web_adverse",
        label,
        detail: sure.map(f => f.summary).join(" "),
        source: `${source}: web search, ${sure.map(f => `${f.source} ${f.url}`).join("; ")}`,
        at: sure.map(f => f.date).find(Boolean) || at,
        key: `web:${kind}:${k(line.name)}`,
        evidence: [...new Set(sure.map(f => `url:${f.url}`))].sort(),
        facts: sure.flatMap(f => [
          { label: "What the source says", value: f.summary },
          { label: "Source", value: [f.source, f.date].filter(Boolean).join(", ") || f.url, url: f.url },
        ]),
      });
    }
  }
  const ch = result.companiesHouse;
  if (ch) {
    const register = `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(ch.number)}`;
    if (ch.status && ch.status !== "active" && DISTRESS.test(ch.status)) {
      flags.push({ kind: "company_status", label: `Companies House shows the company as ${ch.status.replace(/-/g, " ")}`, detail: null, source: `${source}: Companies House`, at,
        key: "ch:status", evidence: [`status:${k(ch.status)}`], facts: [{ label: "Register", value: `${ch.name} (${ch.number})`, url: register }] });
    }
    const recentGazette = (ch.covenant?.gazette || []).filter(g => g.published && Date.parse(g.published) > Date.now() - 3 * 365 * 86400000);
    if (ch.hasInsolvencyHistory || ch.insolvencyCases > 0 || recentGazette.length) {
      flags.push({
        kind: "insolvency",
        label: ch.insolvencyCases ? `Insolvency history at Companies House (${ch.insolvencyCases} case${ch.insolvencyCases === 1 ? "" : "s"})` : recentGazette.length ? "Insolvency notice in The Gazette" : "Insolvency history at Companies House",
        detail: recentGazette[0] ? `${recentGazette[0].title} (${recentGazette[0].published}) ${recentGazette[0].link}` : null,
        source: `${source}: ${recentGazette.length ? "The Gazette" : "Companies House"}`,
        at,
        key: "ch:insolvency",
        evidence: [`cases:${ch.insolvencyCases}`, ...recentGazette.map(g => `gazette:${g.link || k(g.title)}`)].sort(),
        facts: [
          ...(ch.hasInsolvencyHistory || ch.insolvencyCases ? [{ label: "Companies House", value: `Insolvency history${ch.insolvencyCases ? `, ${ch.insolvencyCases} case${ch.insolvencyCases === 1 ? "" : "s"}` : ""}`, url: `${register}/insolvency` }] : []),
          ...recentGazette.map(g => ({ label: "The Gazette", value: `${g.title} (${g.published})`, url: g.link || null })),
        ],
      });
    }
    for (const d of ch.disqualified.filter(d => d.dobMatches !== false)) {
      flags.push({
        kind: "disqualified",
        label: d.dobMatches ? `${d.officer} matches the disqualified directors register` : `${d.officer} may match the disqualified directors register`,
        detail: `Register entry: ${d.match}${d.dobMatches ? ", same date of birth" : ", name only: verify"}${d.url ? ` ${d.url}` : ""}`,
        source: `${source}: Companies House`,
        at,
        key: `ch:disqualified:${k(d.officer)}`,
        evidence: [`entry:${k(d.match)}`],
        facts: [{ label: "Register entry", value: `${d.match}${d.dobMatches ? " (same date of birth)" : " (name only: check the date of birth)"}`, url: d.url }],
      });
    }
    for (const s of ch.statements.filter(s => s.concern)) {
      flags.push({ kind: "ownership_unclear", label: s.words, detail: null, source: `${source}: Companies House PSC statement`, at: s.notifiedOn || at,
        key: `ch:psc_statement:${k(s.statement)}`, evidence: [], facts: [{ label: "Register", value: `${ch.name} (${ch.number})${s.notifiedOn ? `, notified ${s.notifiedOn}` : ""}`, url: `${register}/persons-with-significant-control` }] });
    }
    for (const o of offshoreOwnersOf(ch)) {
      const note = offshoreNote(o.country);
      flags.push({ kind: "offshore_owner", label: `Owned through ${o.name}, registered in ${o.country}${o.foundAt ? ` (up the chain, owning ${o.foundAt})` : ""}`,
        detail: `${note ? `${note} ` : ""}Companies House cannot show who owns ${o.name}: ask the client for a structure chart up to the people, ${o.name}'s register extract, and each owner's ID and proof of address.`,
        source: `${source}: Companies House`, at,
        key: `ch:offshore:${k(o.name)}`, evidence: [`country:${k(o.country)}`],
        facts: [{ label: "Register", value: `${ch.name} (${ch.number})`, url: `${register}/persons-with-significant-control` },
          { label: "Registered in", value: o.country }, ...(note ? [{ label: "Why it is higher risk", value: note }] : [])] });
    }
    // A registered beneficial owner the overseas entity itself declared
    // sanctioned on its latest filing to the Register of Overseas Entities.
    for (const o of ch.owners.filter(o => o.sanctioned)) {
      flags.push({
        kind: "sanctions",
        label: `${o.name} is declared sanctioned on the Register of Overseas Entities`,
        detail: `${ch.name} (${ch.number}) names ${o.name} as a registered beneficial owner and declared them sanctioned on its latest filing.`,
        source: `${source}: Register of Overseas Entities`,
        at,
        key: `roe:sanctioned:${k(o.name)}`,
        evidence: [`entity:${k(ch.number)}`],
        facts: [{ label: "Register of Overseas Entities", value: `${ch.name} (${ch.number}): ${o.name}, declared sanctioned`, url: `${register}/persons-with-significant-control` }],
      });
    }
  }
  // The Charity Commission's register (21 November 2026): a charity removed
  // from the register, insolvent, in administration or a dissolved CIO.
  const cc = result.charity?.status === "found" ? result.charity.charity : null;
  if (cc) {
    for (const x of charityConcerns(cc).filter(x => x.red)) {
      flags.push({
        kind: "charity_status", label: x.label,
        detail: `${cc.name}, registered charity ${cc.number}${result.charity!.via === "trustee" ? `, which ${result.party.name} acts for as its trustee` : ""}.`,
        source: `${source}: the Charity Commission's register`, at,
        key: `cc:${x.key}`, evidence: [`charity:${cc.number}`],
        facts: [{ label: "Register of charities", value: `${cc.name} (${cc.number})`, url: charityRegisterUrl(cc.organisationNumber) }],
      });
    }
  }
  // No Overseas Entity ID for a company whose name reads as registered
  // abroad: a factor to weigh, set aside where the deal does not need one.
  const oe = result.overseasEntity;
  if (!ch && oe?.searched && !oe.number && oe.looksOverseas) {
    flags.push({
      kind: "overseas_entity_missing",
      factor: true,
      label: `No Overseas Entity ID found for ${result.party.name}`,
      detail: "Its name reads as a company registered outside the UK. An overseas company that owns or buys UK land, or takes a lease of more than seven years, must be on the Register of Overseas Entities: ask the client for its Overseas Entity ID, and if it has none, tell the Nominated Officer.",
      source: `${source}: Register of Overseas Entities`,
      at,
      key: `roe:missing:${k(result.party.name)}`,
      evidence: [`candidates:${oe.candidates}`],
      facts: [{ label: "Register of Overseas Entities", value: oe.candidates ? `${oe.candidates} entities of a similar name, none of exactly this name` : "No entity of this name", url: "https://find-and-update.company-information.service.gov.uk/advanced-search" }],
    });
  }
  return flags;
}

// ── KYC4U's note and the deal card ─────────────────────────────────────────

export const precheckDay = (iso: string | null | undefined): string => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "";
};
const list = (items: string[], max = 6) => items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", ");

const DOC_WORDS: Record<PrecheckDocument["kind"], string> = {
  accounts: "latest accounts",
  confirmation_statement: "latest confirmation statement",
  incorporation: "certificate of incorporation",
};

// One line per check, for KYC4U's note: what BGP already did, so KYC4U does
// not ask again for what is public.
export function precheckNote(result: KycPrecheckResult | null, state: "done" | "running" | "none"): string {
  if (state === "running" && !result) return "BGP's own checks (Companies House, sanctions lists, web search for public roles and adverse media) were still running when this request was prepared.";
  if (!result) return "";
  const lines: string[] = [`What BGP checked before asking (${precheckDay(result.ranAt)}):`];
  const ch = result.companiesHouse;
  if (ch) {
    const directors = ch.officers.filter(o => /director|member/i.test(o.role)).map(o => o.name);
    const overseas = isOverseasEntityNumber(ch.number);
    lines.push(`- ${overseas ? "Register of Overseas Entities" : "Companies House"}: ${ch.name} (${ch.number}), ${(ch.status || "status not given").replace(/-/g, " ")}${ch.type ? `, ${ch.type.replace(/-/g, " ")}` : ""}${ch.incorporatedOn ? `, incorporated ${ch.incorporatedOn}` : ""}.${directors.length ? ` Directors: ${list(directors)}.` : ""}${overseas && result.overseasEntity?.number ? " Found by its name: please confirm it is the same company." : ""}${result.gleif?.foundNumber ? " Its number was found in GLEIF by its name: please confirm it is the same company." : ""}`);
    if (ch.listing) {
      lines.push(`- Listed: ${ch.listing.viaParent ? `owned through one company at each level by ${ch.listing.company}, which is` : "the company is"} ${LISTING_WORDS[ch.listing.market]} (PSC exemption${ch.listing.since ? ` since ${ch.listing.since}` : ""}). No beneficial owners asked for (MLR 2017 reg 28(5)).${ch.listing.viaParent ? " Please confirm the chain." : ""}${listingSettled(ch.listing.market) ? "" : " Please confirm the market's disclosure rules are equivalent."}`);
    } else if (ch.owners.length) {
      lines.push(`- Owners on the register: ${list(ch.owners.map(o => `${o.name} (${ownerControlLine(o) || "significant control"})`), 4)}.`);
    } else if (ch.statements.length) {
      lines.push(`- Owners: ${ch.statements.map(s => s.words).join("; ")}.`);
    }
    if (ch.chain.length) lines.push(`- Ownership chain: ${ch.chain.map(c => `${c.name} (${c.number})`).join(" > ")}.${ch.peopleUpChain.length ? ` People with control up the chain: ${list(ch.peopleUpChain.map(p => p.name), 4)}.` : ""}`);
    const abroadNote = ownersAbroadOf(ch);
    // Foreign companies go to KYC4U (Woody, 21 November 2026: "foreign companies I think we will send to KYC4U").
    if (abroadNote.length) lines.push(`- Owned through a company registered abroad: ${ownersAbroadWords(abroadNote)}. Companies House cannot show who owns ${abroadNote.length === 1 ? "it" : "them"}, and BGP does not read foreign registers: please identify the beneficial owners behind ${abroadNote.length === 1 ? "it" : "them"} from the home register and verify them.`);
    // What the app traced itself (21 November 2026): the accounts' parent note and GLEIF.
    const gleifLine = gleifPartyLine(result);
    if (gleifLine) lines.push(`- ${gleifLine}`);
    for (const line of abroadTraceLines(result)) lines.push(`- ${line}`);
    const filed = ch.documents.filter(d => d.kycDocumentId);
    if (filed.length) lines.push(`- Downloaded from Companies House and attached: ${filed.map(d => d.title).join("; ")}.`);
    const tradingNote = tradingState(ch);
    if (tradingNote.words) lines.push(`- ${tradingNote.words}.`);
    const identityNote = precheckIdentity(ch);
    if (identityNote.length) lines.push(`- Identity verification at Companies House: ${identityNote.map(i => `${i.name}, ${i.words}`).join("; ")}.`);
    const found = ch.disqualified.filter(d => d.dobMatches !== false);
    const setAside = ch.disqualified.length - found.length;
    const director = found.length ? found.map(d => `${d.officer} (${d.dobMatches ? "name and date of birth match" : "name only, to verify"})`).join(", ") : "none found";
    lines.push(`- Disqualified directors register: ${director}${setAside ? `; ${setAside} name match${setAside === 1 ? "" : "es"} set aside on date of birth` : ""}.`);
    if (ch.covenant?.grade) lines.push(`- Covenant: grade ${ch.covenant.grade}${ch.covenant.score != null ? ` (${ch.covenant.score}/100)` : ""}${ch.covenant.gazette.length ? `; Gazette insolvency notices: ${ch.covenant.gazette.length}` : ""}.`);
  } else if (result.notAtCompaniesHouse) {
    lines.push(`- Companies House: ${result.notAtCompaniesHouse}`);
    const oe = result.overseasEntity;
    if (oe?.searched) lines.push(`- Register of Overseas Entities: ${oe.error ? `not searched (${oe.error})` : oe.candidates > 1 ? `${oe.candidates} entities of a similar name, none of exactly this name` : "no entity of this name"}.`);
    const gleifLine = gleifPartyLine(result);
    if (gleifLine) lines.push(`- ${gleifLine}`);
    for (const line of abroadTraceLines(result)) lines.push(`- ${line}`);
  }
  for (const line of charityLines(result.charity)) lines.push(`- Charity Commission: ${line}`);
  if (result.sanctions.ran) {
    const possible = result.sanctions.lines.filter(l => l.outcome === "possible");
    const discounted = result.sanctions.lines.filter(l => l.outcome === "discounted");
    lines.push(`- Sanctions: ${result.sanctions.lines.length} names screened against ${result.sanctions.lists.join(" and ")}: ${possible.length ? `possible match for ${possible.map(l => `${l.name} (${l.matches[0]?.name || "listing"})`).join(", ")}` : "no match"}${discounted.length ? `; ${discounted.length} name match${discounted.length === 1 ? "" : "es"} set aside on date of birth` : ""}.`);
  } else {
    lines.push(`- Sanctions: not screened (${result.sanctions.error || "the lists could not be loaded"}).`);
  }
  if (result.screened) lines.push(`- ${screenedLine(result.screened)}`);
  if (result.web.ran) {
    const searched = result.web.lines.filter(l => l.ran);
    const found = searched.flatMap(l => webFindingsOf(l).map(f => `${l.name}: ${f.summary} (${f.url})`));
    lines.push(`- Public roles and adverse media (web search with sources, ${searched.length} searched): ${found.length ? found.slice(0, 5).join("; ") : "nothing found"}.`);
  } else if (result.web.skipped) {
    lines.push(`- Public roles and adverse media: not searched (${result.web.skipped}).`);
  }
  if (result.complyAdvantage.ran) {
    const hits = result.complyAdvantage.lines.filter(l => { const sp = splitProviderMatches(l); return sp.flagged.length > 0 || sp.unjudged; });
    const missed = providerNotScreened(result);
    lines.push(`- ComplyAdvantage: ${hits.length ? `matches for ${hits.map(l => l.name).join(", ")}` : missed.length ? "no matches over its bars among those screened" : "no matches over its bars"}${missed.length ? `; not screened: ${missed.map(notScreenedWords).join("; ")}` : ""}.`);
  } else if (result.complyAdvantage.skipped) {
    lines.push(`- ComplyAdvantage: not used (${result.complyAdvantage.skipped}).`);
  }
  const variants = precheckSpellingVariants(result);
  if (variants.length) lines.push(`- ComplyAdvantage adverse media under names spelt differently, set aside (no date of birth ties them to the person): ${variants.slice(0, 6).map(variantWords).join("; ")}${variants.length > 6 ? `; and ${variants.length - 6} more` : ""}.`);
  const namesakes = precheckNamesakes(result);
  if (namesakes.length) lines.push(`- Possible namesakes, not treated as red flags (ComplyAdvantage profiles with no date of birth to set against the person's, or under its bars where the person's is not known, and web results that may be about someone else): ${namesakes.slice(0, 6).map(n => `${n.name}: ${n.what}`).join("; ")}${namesakes.length > 6 ? `; and ${namesakes.length - 6} more` : ""}.`);
  return lines.join("\n").slice(0, 2800);
}

export interface PrecheckCardLine {
  key: string;
  label: string;
  state: "ok" | "attention" | "info" | "not_run";
  // A screen that should have run and did not (ComplyAdvantage refused or
  // failed someone): never read as clear (22 November 2026).
  failed?: boolean;
  detail: string | null;
  links: Array<{ label: string; url: string }>;
}

// What the deal's AML card lists under "Checked before asking".
export function precheckCardLines(result: KycPrecheckResult): PrecheckCardLine[] {
  const out: PrecheckCardLine[] = [];
  const ch = result.companiesHouse;
  if (ch) {
    const bad = ch.status !== "active" || ch.hasInsolvencyHistory;
    const overseas = isOverseasEntityNumber(ch.number);
    out.push({
      key: "companies_house", label: `${overseas ? "Register of Overseas Entities" : "Companies House"}: ${ch.name} (${ch.number})`, state: bad ? "attention" : "ok",
      detail: [`${(ch.status || "status not given").replace(/-/g, " ")}`, ch.incorporatedOn ? `incorporated ${ch.incorporatedOn}` : "", ch.accountsOverdue ? "accounts overdue" : "", ch.confirmationOverdue ? (overseas ? "update statement overdue" : "confirmation statement overdue") : "",
        result.overseasEntity?.number ? "found by its name: check it is the same company" : "", result.gleif?.foundNumber ? "its number found in GLEIF by its name: check it is the same company" : ""].filter(Boolean).join(", "),
      links: [{ label: "Register", url: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(ch.number)}` }],
    });
    const docs = ch.documents;
    if (docs.length) {
      const filed = docs.filter(d => d.kycDocumentId);
      const failed = docs.filter(d => !d.kycDocumentId);
      out.push({
        key: "documents", label: `Documents from Companies House: ${filed.length ? filed.map(d => DOC_WORDS[d.kind]).join(", ") : "none downloaded"}`,
        state: failed.length && !filed.length ? "attention" : "ok",
        detail: [filed.length ? "Filed on the party's KYC record and attached to a KYC4U request." : "", failed.length ? `Not downloaded: ${failed.map(d => `${DOC_WORDS[d.kind]}${d.error ? ` (${d.error})` : ""}`).join("; ")}` : ""].filter(Boolean).join(" "),
        links: [],
      });
    }
    if (ch.listing) {
      out.push({
        key: "listing", label: ch.listing.viaParent ? `Owned by ${ch.listing.company}, ${LISTING_WORDS[ch.listing.market]}` : `Listed: ${LISTING_WORDS[ch.listing.market]}`, state: "info",
        detail: [`No beneficial owners to ask for.`, ch.listing.viaParent ? `Owned through: ${ch.chain.map(c => c.name).join(" > ") || ch.listing.company}. KYC4U to confirm the chain.` : "", listingSettled(ch.listing.market) ? "" : "KYC4U to confirm the market's disclosure rules are equivalent."].filter(Boolean).join(" "),
        links: [],
      });
    } else {
      const abroad = ownersAbroadOf(ch);
      const concern = ch.statements.some(s => s.concern) || offshoreOwnersOf(ch).length > 0 || abroad.length > 0;
      out.push({
        key: "owners", label: ch.owners.length ? `Owners on the register: ${list(ch.owners.map(o => o.name), 4)}` : "No owners on the register",
        state: concern ? "attention" : ch.owners.length ? "ok" : "info",
        detail: [ch.owners.map(o => `${o.name}: ${ownerControlLine(o) || "significant control"}`).join("; "), ch.statements.map(s => s.words).join("; "), ch.chain.length ? `Chain: ${ch.chain.map(c => c.name).join(" > ")}` : "",
          abroad.length ? `Registered abroad, so Companies House cannot show who owns ${abroad.length === 1 ? "it" : "them"}: ${ownersAbroadWords(abroad)}. The people behind ${abroad.length === 1 ? "it" : "them"} still need finding` : ""].filter(Boolean).join(". ") || null,
        links: [],
      });
    }
    const officers = ch.officers.filter(o => /director|member/i.test(o.role));
    out.push({
      key: "directors", label: `Directors: ${officers.length ? list(officers.map(o => o.name), 4) : "none listed"}`,
      state: ch.disqualified.some(d => d.dobMatches !== false) ? "attention" : "ok",
      detail: ch.disqualified.length ? `Disqualified register: ${ch.disqualified.map(d => `${d.officer} ↔ ${d.match} (${d.dobMatches ? "same date of birth" : d.dobMatches === false ? "different date of birth, set aside" : "name only"})`).join("; ")}` : "None on the disqualified directors register.",
      links: [],
    });
    // Identity verification at Companies House (21 November 2026): information, never BGP's own check.
    const identity = precheckIdentity(ch);
    if (identity.length) {
      const verified = identity.filter(i => i.state === "verified").length;
      out.push({
        key: "identity_verification", label: `Identity verified at Companies House: ${verified} of ${identity.length}`,
        state: identity.some(i => i.state === "overdue") ? "attention" : verified === identity.length ? "ok" : "info",
        detail: identity.map(i => `${i.name} (${i.role}): ${i.words}`).join("; "),
        links: [],
      });
    }
    const trading = tradingState(ch);
    if (trading.words) out.push({ key: "trading", label: trading.kind === "new" ? "Newly formed" : "Not trading", state: "attention", detail: `${trading.words}. A warning to weigh: is the company the one doing the transaction, and is it funded for it?`, links: [] });
  } else {
    out.push({ key: "companies_house", label: "Companies House", state: "info", detail: result.notAtCompaniesHouse, links: [] });
    const oe = result.overseasEntity;
    if (oe?.searched) {
      out.push({
        key: "overseas_entity", label: "Register of Overseas Entities", state: oe.looksOverseas && !oe.error ? "attention" : "info",
        detail: oe.error ? `Not searched: ${oe.error}` : oe.candidates > 1 ? `${oe.candidates} entities of a similar name, none of exactly this name.` : "No entity of this name.",
        links: [{ label: "Search the register", url: "https://find-and-update.company-information.service.gov.uk/advanced-search" }],
      });
    }
  }
  const pc = result.charity;
  if (pc && pc.status !== "skipped") {
    const c = pc.status === "found" ? pc.charity : null;
    out.push({
      key: "charity",
      label: c ? `Charity Commission: ${c.name} (${c.number})${pc.via === "trustee" ? `, which it acts for as trustee` : ""}` : pc.status === "ambiguous" ? "Charity Commission: more than one charity could be it" : pc.status === "error" ? "Charity Commission: not read" : "Charity Commission: not on the register",
      state: c ? (charityConcerns(c).length ? "attention" : "ok") : pc.status === "error" ? "not_run" : "info",
      detail: charityLines(pc).join(" "),
      links: c ? [{ label: "Register of charities", url: charityRegisterUrl(c.organisationNumber) }] : [],
    });
  }
  const g = result.gleif;
  if (g && g.trace.status !== "skipped" && !result.abroad?.party) {
    out.push({
      key: "gleif", label: g.trace.entity ? `GLEIF: LEI ${g.trace.entity.lei}` : g.trace.status === "error" ? "GLEIF: not read" : "GLEIF: no LEI",
      state: g.trace.status === "error" ? "not_run" : "info", detail: gleifPartyWords(g),
      links: g.trace.entity ? [{ label: "GLEIF record", url: `https://search.gleif.org/#/record/${g.trace.entity.lei}` }] : [],
    });
  }
  if (result.sanctions.ran) {
    const possible = result.sanctions.lines.filter(l => l.outcome === "possible");
    const discounted = result.sanctions.lines.filter(l => l.outcome === "discounted");
    // The UK list is the one the law requires: screened without it is not a
    // clear screen (22 November 2026).
    const ukMissing = !result.sanctions.lists.some(l => l.includes(SANCTIONS_LIST_NAME.UK));
    out.push({
      key: "sanctions", label: `Sanctions: ${result.sanctions.lines.length} names screened, ${possible.length ? `${possible.length} possible match${possible.length === 1 ? "" : "es"}` : "no match"}`,
      state: possible.length ? "attention" : "ok", ...(ukMissing ? { failed: true } : {}),
      detail: [ukMissing ? "The UK Sanctions List could not be downloaded: run the checks again" : "", `Screened against ${result.sanctions.lists.join(" and ")}`, possible.map(l => `${l.name} ↔ ${l.matches[0]?.name}: ${String(l.matches[0]?.why || "").replace(/\.\s*$/, "")}`).join("; "), discounted.length ? `Set aside on date of birth: ${discounted.map(l => `${l.name} ↔ ${l.matches[0]?.name}`).join("; ")}` : ""].filter(Boolean).join(". ") + ".",
      links: [],
    });
  } else {
    out.push({ key: "sanctions", label: "Sanctions: not screened", state: "not_run", failed: true, detail: result.sanctions.error, links: [] });
  }
  if (result.screened) {
    const s = result.screened;
    out.push({
      key: "who_screened", label: `Screened for public roles and adverse media: ${s.people.length ? list(s.people, 4) : s.basis === "individual" ? "the person" : "the company only"}`, state: "info",
      detail: `${SCREEN_BASIS_WORDS[s.basis][0].toUpperCase()}${SCREEN_BASIS_WORDS[s.basis].slice(1)}, each person with the date of birth Companies House gives.${s.sanctionsOnly.length ? ` Sanctions lists only: ${list(s.sanctionsOnly, 6)}.` : ""}`,
      links: [],
    });
  }
  if (result.web.ran) {
    const searched = result.web.lines.filter(l => l.ran);
    const findings = searched.flatMap(l => webFindingsOf(l).filter(f => !f.unsureIdentity).map(f => ({ l, f })));
    const failed = result.web.lines.filter(l => !l.ran);
    out.push({
      key: "web", label: `Public roles and adverse media: ${searched.length} searched, ${findings.length ? `${findings.length} to review` : "nothing found"}`,
      state: findings.length ? "attention" : failed.length && !searched.length ? "not_run" : "ok",
      detail: [searched.map(l => l.name).join(", "), failed.length ? `Not searched: ${failed.map(l => l.name).join(", ")}` : "", searched.some(l => l.unsourced) ? "Anything the search said without a source was left out." : ""].filter(Boolean).join(". "),
      links: findings.slice(0, 8).map(({ l, f }) => ({ label: `${l.name}: ${f.summary}`.slice(0, 140), url: f.url })),
    });
  } else {
    out.push({ key: "web", label: "Public roles and adverse media: not searched", state: "not_run", detail: result.web.skipped, links: [] });
  }
  if (result.complyAdvantage.ran) {
    const hits = result.complyAdvantage.lines.map(l => ({ l, sp: splitProviderMatches(l) })).filter(({ sp }) => sp.flagged.length > 0 || sp.unjudged);
    // A subject Mesh refused or failed was not screened: never "no matches".
    const missed = providerNotScreened(result);
    const said = [hits.length ? `${hits.length} to review` : null, missed.length ? `${missed.length} not screened` : null].filter(Boolean).join(", ");
    out.push({ key: "comply_advantage", label: `ComplyAdvantage: ${said || "no matches over its bars"}`, state: hits.length ? "attention" : missed.length ? "not_run" : "ok",
      ...(missed.length ? { failed: true } : {}),
      detail: [hits.map(({ l, sp }) => `${l.name}: ${(sp.unjudged ? l.types : [...new Set(sp.flagged.map(m => m.kind))]).map(providerKindWords).join(", ")}`).join("; "),
        missed.length ? `Not screened: ${missed.map(notScreenedWords).join("; ")}` : ""].filter(Boolean).join(". ") || null, links: [] });
  } else if (result.complyAdvantage.skipped) {
    out.push({ key: "comply_advantage", label: "ComplyAdvantage: not used", state: "not_run", ...(caSkipIsFailure(result.complyAdvantage.skipped) ? { failed: true } : {}), detail: result.complyAdvantage.skipped, links: [] });
  }
  // Possible namesakes: listed to look at, never a red flag (Woody, 19 November 2026).
  const namesakes = precheckNamesakes(result);
  if (namesakes.length) {
    out.push({
      key: "namesakes", label: `Possible namesakes to check: ${namesakes.length}`, state: "info",
      detail: `ComplyAdvantage profiles nothing ties to the person (no date of birth to set against the one Companies House gives, or under its bars of 60% for a public role and 90% for anything else when the person's date of birth is not known) and web results that may be about someone else of the same name. Not red flags. ${namesakes.filter(n => !n.url).slice(0, 8).map(n => `${n.name}: ${n.what}`).join("; ")}`.trim(),
      links: namesakes.filter(n => n.url).slice(0, 8).map(n => ({ label: `${n.name}: ${n.what}`.slice(0, 140), url: n.url! })),
    });
  }
  // Adverse media under a name spelt differently: set aside, listed for the officers (Woody, 21 November 2026).
  const variants = precheckSpellingVariants(result);
  if (variants.length) {
    out.push({
      key: "spelling_variants", label: `Set aside, spelt differently: ${variants.length}`, state: "info",
      detail: `ComplyAdvantage adverse media profiles under a name spelt differently from the person's or company's, with no date of birth matching theirs. Not red flags or namesakes to check. ${variants.slice(0, 10).map(variantWords).join("; ")}${variants.length > 10 ? `; and ${variants.length - 10} more` : ""}`.trim(),
      links: [],
    });
  }
  return out;
}
