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
// KYC4U, BGP's MLRO, does.

import { defaultKycDocs, type KycDocKey, type KycPartyKind } from "./kyc-request";
import type { KycRedFlag } from "./kyc-red-flags";

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
  dob?: { month?: number | null; year?: number | null } | null;
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
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
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

const sameToken = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && levenshtein(a, b) <= 1);
const covers = (outer: string[], inner: string[]) => inner.every(t => outer.some(o => sameToken(o, t)));

// One name holds every word of the other (two words at least), in any
// order: "SMITH, John David" and "John Smith".
export function personNamesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a), tb = nameTokens(b);
  return (ta.length >= 2 && covers(tb, ta)) || (tb.length >= 2 && covers(ta, tb));
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
// The lists (the UK Sanctions List and the US OFAC list) are matched on
// names, so a common name matches someone else. A listing counts as a
// possible match when one name holds every word of the other (two words at
// least), and is set aside only when both dates of birth are known and the
// years are more than one apart. Everything else is "no match".

export interface ListEntry {
  name: string;
  source: "UK" | "US";
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
      if (!summary) continue;
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
}

export interface ProviderLine { name: string; status: "clear" | "possible" | "error"; types: string[]; detail: string | null }

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
    peopleUpChain: Array<{ name: string; foundAt: string; controls: string[] }>;
    offshoreOwners: Array<{ name: string; country: string }>;
    disqualified: Array<{ officer: string; match: string; dobMatches: boolean | null; url: string | null }>;
    covenant: { grade: string | null; score: number | null; flags: Array<{ level: string; label: string; detail?: string | null }>; gazette: Array<{ title: string; published: string; link: string }> } | null;
    documents: PrecheckDocument[];
  };
  // Why there is no Companies House record to read.
  notAtCompaniesHouse: string | null;
  sanctions: { ran: boolean; lists: string[]; lines: SanctionsLine[]; error: string | null };
  web: { ran: boolean; lines: WebSearchLine[]; skipped: string | null };
  complyAdvantage: { ran: boolean; lines: ProviderLine[]; skipped: string | null };
  errors: string[];
}

export const isPrecheckResult = (value: unknown): value is KycPrecheckResult =>
  !!value && typeof value === "object" && (value as any).kind === "precheck";

// The column the readers already use (kyc_investigations.sanctions_match):
// true for a possible match on either list or with ComplyAdvantage, false
// when every screen ran clear, null when the lists could not be screened.
export function precheckSanctionsMatch(result: Pick<KycPrecheckResult, "sanctions" | "complyAdvantage">): boolean | null {
  const provider = result.complyAdvantage.lines.some(l => l.status === "possible" && l.types.some(t => /sanction|warning/.test(t)));
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
}

export interface PrecheckAsks {
  docs: KycDocKey[];
  notAsked: Array<{ key: KycDocKey; reason: string }>;
  // The owners on the register, shown to the client to confirm in place of
  // asking for a chart.
  confirmOwners: Array<{ name: string; detail: string }> | null;
  // The people whose ID is asked for, where the register names them.
  ownerNames: string[];
}

export function askInputFrom(result: KycPrecheckResult | null): PrecheckAskInput | null {
  if (!result) return null;
  const ch = result.companiesHouse;
  return {
    subjectKind: result.party.subjectKind,
    ukRegistered: !!ch,
    listing: ch?.listing || null,
    owners: ch?.owners || [],
    peopleUpChain: ch?.peopleUpChain || [],
    directors: (ch?.officers || []).filter(o => /director|member/i.test(o.role)).map(o => o.name),
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
    const reason = `${who} (Companies House PSC exemption${input.listing.since ? ` since ${input.listing.since}` : ""}): no beneficial owners to identify (MLR 2017 reg 28(5)).${check}`;
    drop("ownership", reason);
    drop("owner_ids", reason);
  } else if (input.owners.length) {
    confirmOwners = input.owners.map(o => ({ name: o.name, detail: ownerControlLine(o) || "a person with significant control" }));
    const people = [
      ...input.owners.filter(o => o.kind === "individual").map(o => o.name),
      ...input.peopleUpChain.map(p => p.name),
    ];
    ownerNames = [...new Set(people)];
    drop("ownership", `Companies House lists ${input.owners.length === 1 ? "its owner" : `its ${input.owners.length} owners`}: the client is asked to confirm the list instead.`);
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
  return { docs, notAsked, confirmOwners, ownerNames };
}

// ── Red flags ───────────────────────────────────────────────────────────────

// Secrecy and high-risk places a corporate owner can be registered in: a
// reason for KYC4U to look, never a verdict. The FATF call-for-action list
// (Iran, North Korea, Myanmar) and the usual secrecy jurisdictions.
const OFFSHORE = /\b(british virgin islands|bvi|cayman|panama|seychelles|belize|marshall islands|bahamas|anguilla|turks and caicos|vanuatu|samoa|liechtenstein|iran|north korea|korea, democratic|myanmar|burma)\b/i;
export const isOffshoreCountry = (country: string | null | undefined): boolean => OFFSHORE.test(String(country || ""));

const DISTRESS = /liquidation|receivership|administration|insolvency|voluntary-arrangement|dissolved|removed|struck|closed/i;

// sanctionsCurrent: this pre-check is the party's latest screening, so its
// sanctions lines stand (a later screening replaces them).
export function precheckRedFlags(result: KycPrecheckResult, opts: { sanctionsCurrent: boolean }): KycRedFlag[] {
  const flags: KycRedFlag[] = [];
  const at = result.ranAt || null;
  const source = "BGP's checks before asking";
  if (opts.sanctionsCurrent) {
    for (const line of result.sanctions.lines.filter(l => l.outcome === "possible")) {
      const m = line.matches[0];
      flags.push({
        kind: "sanctions",
        label: `Possible sanctions match for ${line.name} (${line.role})`,
        detail: m ? `${m.source === "UK" ? "UK Sanctions List" : "US OFAC list"}: ${m.name}${m.regime ? `, ${m.regime}` : ""}. ${m.why}` : null,
        source: `${source}: sanctions lists`,
        at,
      });
    }
    for (const line of result.complyAdvantage.lines.filter(l => l.status === "possible")) {
      flags.push({ kind: "provider_screen", label: `ComplyAdvantage match for ${line.name}`, detail: line.types.join(", ") || line.detail, source: `${source}: ComplyAdvantage`, at });
    }
  }
  for (const line of result.web.lines) {
    for (const f of line.findings) {
      flags.push({
        kind: f.kind === "public_role" ? "web_pep" : "web_adverse",
        label: f.kind === "public_role" ? `Possible public role for ${line.name}` : `Adverse media about ${line.name}`,
        detail: `${f.summary}${f.unsureIdentity ? " (the source may be about someone else of the same name)" : ""}`,
        source: `${source}: web search, ${f.source} ${f.url}`,
        at: f.date || at,
      });
    }
  }
  const ch = result.companiesHouse;
  if (ch) {
    if (ch.status && ch.status !== "active" && DISTRESS.test(ch.status)) {
      flags.push({ kind: "company_status", label: `Companies House shows the company as ${ch.status.replace(/-/g, " ")}`, detail: null, source: `${source}: Companies House`, at });
    }
    const recentGazette = (ch.covenant?.gazette || []).filter(g => g.published && Date.parse(g.published) > Date.now() - 3 * 365 * 86400000);
    if (ch.hasInsolvencyHistory || ch.insolvencyCases > 0 || recentGazette.length) {
      flags.push({
        kind: "insolvency",
        label: ch.insolvencyCases ? `Insolvency history at Companies House (${ch.insolvencyCases} case${ch.insolvencyCases === 1 ? "" : "s"})` : recentGazette.length ? "Insolvency notice in The Gazette" : "Insolvency history at Companies House",
        detail: recentGazette[0] ? `${recentGazette[0].title} (${recentGazette[0].published}) ${recentGazette[0].link}` : null,
        source: `${source}: ${recentGazette.length ? "The Gazette" : "Companies House"}`,
        at,
      });
    }
    for (const d of ch.disqualified.filter(d => d.dobMatches !== false)) {
      flags.push({
        kind: "disqualified",
        label: d.dobMatches ? `${d.officer} matches the disqualified directors register` : `${d.officer} may match the disqualified directors register`,
        detail: `Register entry: ${d.match}${d.dobMatches ? ", same date of birth" : ", name only: verify"}${d.url ? ` ${d.url}` : ""}`,
        source: `${source}: Companies House`,
        at,
      });
    }
    for (const s of ch.statements.filter(s => s.concern)) {
      flags.push({ kind: "ownership_unclear", label: s.words, detail: null, source: `${source}: Companies House PSC statement`, at: s.notifiedOn || at });
    }
    for (const o of ch.offshoreOwners) {
      flags.push({ kind: "offshore_owner", label: `Owned through ${o.name}, registered in ${o.country}`, detail: null, source: `${source}: Companies House`, at });
    }
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
    lines.push(`- Companies House: ${ch.name} (${ch.number}), ${(ch.status || "status not given").replace(/-/g, " ")}${ch.type ? `, ${ch.type.replace(/-/g, " ")}` : ""}${ch.incorporatedOn ? `, incorporated ${ch.incorporatedOn}` : ""}.${directors.length ? ` Directors: ${list(directors)}.` : ""}`);
    if (ch.listing) {
      lines.push(`- Listed: ${ch.listing.viaParent ? `owned through one company at each level by ${ch.listing.company}, which is` : "the company is"} ${LISTING_WORDS[ch.listing.market]} (PSC exemption${ch.listing.since ? ` since ${ch.listing.since}` : ""}). No beneficial owners asked for (MLR 2017 reg 28(5)).${ch.listing.viaParent ? " Please confirm the chain." : ""}${listingSettled(ch.listing.market) ? "" : " Please confirm the market's disclosure rules are equivalent."}`);
    } else if (ch.owners.length) {
      lines.push(`- Owners on the register: ${list(ch.owners.map(o => `${o.name} (${ownerControlLine(o) || "significant control"})`), 4)}.`);
    } else if (ch.statements.length) {
      lines.push(`- Owners: ${ch.statements.map(s => s.words).join("; ")}.`);
    }
    if (ch.chain.length) lines.push(`- Ownership chain: ${ch.chain.map(c => `${c.name} (${c.number})`).join(" > ")}.${ch.peopleUpChain.length ? ` People with control up the chain: ${list(ch.peopleUpChain.map(p => p.name), 4)}.` : ""}`);
    const filed = ch.documents.filter(d => d.kycDocumentId);
    if (filed.length) lines.push(`- Downloaded from Companies House and attached: ${filed.map(d => d.title).join("; ")}.`);
    const found = ch.disqualified.filter(d => d.dobMatches !== false);
    const setAside = ch.disqualified.length - found.length;
    const director = found.length ? found.map(d => `${d.officer} (${d.dobMatches ? "name and date of birth match" : "name only, to verify"})`).join(", ") : "none found";
    lines.push(`- Disqualified directors register: ${director}${setAside ? `; ${setAside} name match${setAside === 1 ? "" : "es"} set aside on date of birth` : ""}.`);
    if (ch.covenant?.grade) lines.push(`- Covenant: grade ${ch.covenant.grade}${ch.covenant.score != null ? ` (${ch.covenant.score}/100)` : ""}${ch.covenant.gazette.length ? `; Gazette insolvency notices: ${ch.covenant.gazette.length}` : ""}.`);
  } else if (result.notAtCompaniesHouse) {
    lines.push(`- Companies House: ${result.notAtCompaniesHouse}`);
  }
  if (result.sanctions.ran) {
    const possible = result.sanctions.lines.filter(l => l.outcome === "possible");
    const discounted = result.sanctions.lines.filter(l => l.outcome === "discounted");
    lines.push(`- Sanctions: ${result.sanctions.lines.length} names screened against ${result.sanctions.lists.join(" and ")}: ${possible.length ? `possible match for ${possible.map(l => `${l.name} (${l.matches[0]?.name || "listing"})`).join(", ")}` : "no match"}${discounted.length ? `; ${discounted.length} name match${discounted.length === 1 ? "" : "es"} set aside on date of birth` : ""}.`);
  } else {
    lines.push(`- Sanctions: not screened (${result.sanctions.error || "the lists could not be loaded"}).`);
  }
  if (result.web.ran) {
    const searched = result.web.lines.filter(l => l.ran);
    const found = searched.flatMap(l => l.findings.map(f => `${l.name}: ${f.summary} (${f.url})`));
    lines.push(`- Public roles and adverse media (web search with sources, ${searched.length} searched): ${found.length ? found.slice(0, 5).join("; ") : "nothing found"}.`);
  } else if (result.web.skipped) {
    lines.push(`- Public roles and adverse media: not searched (${result.web.skipped}).`);
  }
  if (result.complyAdvantage.ran) {
    const hits = result.complyAdvantage.lines.filter(l => l.status === "possible");
    lines.push(`- ComplyAdvantage: ${hits.length ? `matches for ${hits.map(l => l.name).join(", ")}` : "no matches"}.`);
  } else if (result.complyAdvantage.skipped) {
    lines.push(`- ComplyAdvantage: not used (${result.complyAdvantage.skipped}).`);
  }
  return lines.join("\n").slice(0, 2800);
}

export interface PrecheckCardLine {
  key: string;
  label: string;
  state: "ok" | "attention" | "info" | "not_run";
  detail: string | null;
  links: Array<{ label: string; url: string }>;
}

// What the deal's AML card lists under "Checked before asking".
export function precheckCardLines(result: KycPrecheckResult): PrecheckCardLine[] {
  const out: PrecheckCardLine[] = [];
  const ch = result.companiesHouse;
  if (ch) {
    const bad = ch.status !== "active" || ch.hasInsolvencyHistory;
    out.push({
      key: "companies_house", label: `Companies House: ${ch.name} (${ch.number})`, state: bad ? "attention" : "ok",
      detail: [`${(ch.status || "status not given").replace(/-/g, " ")}`, ch.incorporatedOn ? `incorporated ${ch.incorporatedOn}` : "", ch.accountsOverdue ? "accounts overdue" : "", ch.confirmationOverdue ? "confirmation statement overdue" : ""].filter(Boolean).join(", "),
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
        detail: [`No beneficial owners to ask for (MLR 2017 reg 28(5)).`, ch.listing.viaParent ? `Owned through: ${ch.chain.map(c => c.name).join(" > ") || ch.listing.company}. KYC4U to confirm the chain.` : "", listingSettled(ch.listing.market) ? "" : "KYC4U to confirm the market's disclosure rules are equivalent."].filter(Boolean).join(" "),
        links: [],
      });
    } else {
      const concern = ch.statements.some(s => s.concern) || ch.offshoreOwners.length > 0;
      out.push({
        key: "owners", label: ch.owners.length ? `Owners on the register: ${list(ch.owners.map(o => o.name), 4)}` : "No owners on the register",
        state: concern ? "attention" : ch.owners.length ? "ok" : "info",
        detail: [ch.owners.map(o => `${o.name}: ${ownerControlLine(o) || "significant control"}`).join("; "), ch.statements.map(s => s.words).join("; "), ch.chain.length ? `Chain: ${ch.chain.map(c => c.name).join(" > ")}` : ""].filter(Boolean).join(". ") || null,
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
  } else {
    out.push({ key: "companies_house", label: "Companies House", state: "info", detail: result.notAtCompaniesHouse, links: [] });
  }
  if (result.sanctions.ran) {
    const possible = result.sanctions.lines.filter(l => l.outcome === "possible");
    const discounted = result.sanctions.lines.filter(l => l.outcome === "discounted");
    out.push({
      key: "sanctions", label: `Sanctions: ${result.sanctions.lines.length} names screened, ${possible.length ? `${possible.length} possible match${possible.length === 1 ? "" : "es"}` : "no match"}`,
      state: possible.length ? "attention" : "ok",
      detail: [`Screened against ${result.sanctions.lists.join(" and ")}`, possible.map(l => `${l.name} ↔ ${l.matches[0]?.name}: ${String(l.matches[0]?.why || "").replace(/\.\s*$/, "")}`).join("; "), discounted.length ? `Set aside on date of birth: ${discounted.map(l => `${l.name} ↔ ${l.matches[0]?.name}`).join("; ")}` : ""].filter(Boolean).join(". ") + ".",
      links: [],
    });
  } else {
    out.push({ key: "sanctions", label: "Sanctions: not screened", state: "not_run", detail: result.sanctions.error, links: [] });
  }
  if (result.web.ran) {
    const searched = result.web.lines.filter(l => l.ran);
    const findings = searched.flatMap(l => l.findings.map(f => ({ l, f })));
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
    const hits = result.complyAdvantage.lines.filter(l => l.status === "possible");
    out.push({ key: "comply_advantage", label: `ComplyAdvantage: ${hits.length ? `${hits.length} to review` : "no matches"}`, state: hits.length ? "attention" : "ok", detail: hits.map(l => `${l.name}: ${l.types.join(", ")}`).join("; ") || null, links: [] });
  } else if (result.complyAdvantage.skipped) {
    out.push({ key: "comply_advantage", label: "ComplyAdvantage: not used", state: "not_run", detail: result.complyAdvantage.skipped, links: [] });
  }
  return out;
}
